import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, posix } from "node:path";
import type { ReferenceNode } from "@sourcebook/shared";
import { HttpError, badRequest, notFound } from "../errors.js";
import { Mutex } from "../fs/mutex.js";

export const REFERENCES_DIR = "references";

/** A single file or folder name: no separators, no traversal, no hidden/control characters. */
export function validateName(name: string): string {
  const n = name.normalize("NFC").trim();
  if (!n || n === "." || n === ".." || n.startsWith(".") || /[\/\\\u0000-\u001f]/.test(n) || n.length > 255) {
    throw badRequest(`Invalid name "${name}"`);
  }
  return n;
}

/** Normalizes a references-relative path; every segment must be a valid name. */
export function validatePath(path: string): string {
  if (path === "" || path === "/") return "";
  return path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map(validateName)
    .join("/");
}

/**
 * Arbitrary input files for the project, kept under references/ with user-defined folders.
 * The filesystem is the source of truth (files copied in by hand show up too).
 */
export class ReferencesStore {
  private mutex = new Mutex();
  readonly dir: string;

  constructor(projectRoot: string) {
    this.dir = join(projectRoot, REFERENCES_DIR);
  }

  abs(path: string): string {
    return join(this.dir, ...validatePath(path).split("/").filter(Boolean));
  }

  async tree(): Promise<ReferenceNode> {
    await mkdir(this.dir, { recursive: true });
    const walk = async (rel: string, name: string): Promise<ReferenceNode> => {
      const entries = await readdir(join(this.dir, rel), { withFileTypes: true });
      const children: ReferenceNode[] = [];
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) children.push(await walk(childRel, e.name));
        else if (e.isFile()) {
          const st = await stat(join(this.dir, childRel));
          children.push({ name: e.name, path: childRel, kind: "file", size: st.size, modified: st.mtime.toISOString() });
        }
      }
      children.sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === "dir" ? -1 : 1,
      );
      return { name, path: rel, kind: "dir", children };
    };
    return walk("", REFERENCES_DIR);
  }

  /** Stats a file, 404 when missing or not a regular file. */
  async file(path: string) {
    const abs = this.abs(path);
    const st = await stat(abs).catch(() => null);
    if (!st?.isFile()) throw notFound(`Reference ${path}`);
    return { abs, size: st.size };
  }

  createFolder(path: string): Promise<string> {
    return this.mutex.run(async () => {
      const rel = validatePath(path);
      const abs = this.abs(rel);
      if (existsSync(abs)) throw new HttpError(409, `"${rel}" already exists`);
      await mkdir(abs, { recursive: true });
      return rel;
    });
  }

  /** Saves an uploaded file in `dir`, adding " (n)" before the extension on name clashes. */
  save(dir: string, fileName: string, data: Uint8Array): Promise<string> {
    return this.mutex.run(async () => {
      const relDir = validatePath(dir);
      const absDir = this.abs(relDir);
      await mkdir(absDir, { recursive: true });
      const name = validateName(fileName.split(/[\/\\]/).pop() ?? "");
      const ext = extname(name);
      const stem = name.slice(0, name.length - ext.length);
      let candidate = name;
      for (let i = 1; existsSync(join(absDir, candidate)); i++) candidate = `${stem} (${i})${ext}`;
      await writeFile(join(absDir, candidate), data);
      return relDir ? `${relDir}/${candidate}` : candidate;
    });
  }

  rename(path: string, newName: string): Promise<string> {
    return this.mutex.run(async () => {
      const rel = validatePath(path);
      if (!rel) throw badRequest("Cannot rename the references folder");
      const from = this.abs(rel);
      if (!existsSync(from)) throw notFound(`Reference ${rel}`);
      const parent = posix.dirname(rel);
      const target = (parent === "." ? "" : `${parent}/`) + validateName(newName);
      if (target === rel) return rel;
      const to = this.abs(target);
      // Allow case-only renames on case-insensitive filesystems; otherwise refuse to overwrite.
      if (existsSync(to) && target.toLowerCase() !== rel.toLowerCase()) {
        throw new HttpError(409, `"${target}" already exists`);
      }
      await rename(from, to);
      return target;
    });
  }

  /**
   * Resolves a selection into archive entries: files, plus folders expanded recursively (empty folders
   * kept as directory entries). Names are relative to `base` when inside it; duplicates are dropped.
   */
  async zipEntries(paths: string[], base: string): Promise<{ name: string; abs: string | null }[]> {
    const relBase = validatePath(base);
    const entries = new Map<string, string | null>();
    const nameFor = (rel: string) => (relBase && rel.startsWith(`${relBase}/`) ? rel.slice(relBase.length + 1) : rel);
    const add = async (rel: string) => {
      const abs = this.abs(rel);
      const st = await stat(abs).catch(() => null);
      if (!st) throw notFound(`Reference ${rel}`);
      if (st.isFile()) {
        entries.set(nameFor(rel), abs);
        return;
      }
      const children = (await readdir(abs)).filter((c) => !c.startsWith("."));
      if (!children.length) entries.set(`${nameFor(rel)}/`, null);
      for (const c of children.sort()) await add(`${rel}/${c}`);
    };
    for (const p of paths) {
      const rel = validatePath(p);
      if (!rel) throw badRequest("Select files or folders inside references/");
      await add(rel);
    }
    return [...entries].map(([name, abs]) => ({ name, abs }));
  }

  /** Deletes several entries at once; entries inside an already-selected folder are skipped. */
  deleteMany(paths: string[]): Promise<string[]> {
    return this.mutex.run(async () => {
      const rels = [...new Set(paths.map(validatePath))].sort();
      if (rels.some((r) => !r)) throw badRequest("Cannot delete the references folder");
      const roots = rels.filter((r) => !rels.some((o) => o !== r && r.startsWith(`${o}/`)));
      for (const r of roots) if (!existsSync(this.abs(r))) throw notFound(`Reference ${r}`);
      for (const r of roots) await rm(this.abs(r), { recursive: true });
      return roots;
    });
  }

  delete(path: string): Promise<void> {
    return this.mutex.run(async () => {
      const rel = validatePath(path);
      if (!rel) throw badRequest("Cannot delete the references folder");
      const abs = this.abs(rel);
      if (!existsSync(abs)) throw notFound(`Reference ${rel}`);
      await rm(abs, { recursive: true });
    });
  }
}
