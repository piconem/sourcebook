import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  NotebookIndexSchema,
  ProjectIdSchema,
  ProjectMetaSchema,
  type CreateProjectBody,
  type NotebookKind,
  type ProjectMeta,
  type ProjectSummary,
  type Registry,
  type SubBlockTypeCore,
  type UpdateProjectBody,
} from "@sourcebook/shared";
import { HttpError, badRequest, notFound } from "../errors.js";
import { readJson, writeJsonAtomic } from "../fs/atomic.js";
import { Mutex } from "../fs/mutex.js";
import { slugify } from "../fs/names.js";
import { NOTEBOOK_FILE, NotebookStore } from "./NotebookStore.js";
import { ReferencesStore } from "./ReferencesStore.js";
import { validateTemplateArchive, type ArchiveValidation } from "./templateArchive.js";

export const KINDS: NotebookKind[] = ["projects", "templates"];
export const PROJECT_FILE = "project.json";

export interface NotebookContext {
  kind: NotebookKind;
  id: string;
  store: NotebookStore;
  refs: ReferencesStore;
}

/** Not carried over when a project/template is copied. */
const isCommentsFile = (path: string) => path.endsWith(".comments.json");

async function latestMtime(dir: string): Promise<number> {
  let latest = (await stat(dir)).mtimeMs;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    latest = Math.max(latest, e.isDirectory() ? await latestMtime(p) : (await stat(p)).mtimeMs);
  }
  return latest;
}

/**
 * The workspace: `<root>/projects/<id>` and `<root>/templates/<id>`, each a notebook folder plus a
 * `project.json` (name, description, dates). Ids are folder names (slugs of the initial name).
 */
export class WorkspaceStore {
  private mutex = new Mutex();
  private open_ = new Map<string, Promise<NotebookContext>>();

  constructor(
    readonly root: string,
    private readonly registry: Registry<SubBlockTypeCore<any>>,
  ) {}

  async init() {
    for (const k of KINDS) await mkdir(join(this.root, k), { recursive: true });
  }

  dir(kind: NotebookKind, id: string): string {
    const parsed = ProjectIdSchema.safeParse(id);
    if (!parsed.success) throw badRequest(`Invalid id "${id}"`);
    return join(this.root, kind, id);
  }

  private async meta(kind: NotebookKind, id: string): Promise<ProjectMeta> {
    const dir = this.dir(kind, id);
    const file = join(dir, PROJECT_FILE);
    if (existsSync(file)) {
      const parsed = ProjectMetaSchema.safeParse(await readJson(file).catch(() => null));
      if (parsed.success) return parsed.data;
    }
    // A notebook folder without metadata (e.g. copied in by hand): derive it.
    const st = await stat(dir);
    return { name: basename(dir), description: "", createdAt: (st.birthtime.getTime() ? st.birthtime : st.mtime).toISOString() };
  }

  async summary(kind: NotebookKind, id: string): Promise<ProjectSummary> {
    const dir = this.dir(kind, id);
    if (!existsSync(join(dir, NOTEBOOK_FILE)) && !existsSync(join(dir, PROJECT_FILE))) throw notFound(`${kind === "projects" ? "Project" : "Template"} ${id}`);
    const meta = await this.meta(kind, id);
    let sections = 0;
    try {
      sections = NotebookIndexSchema.parse(await readJson(join(dir, NOTEBOOK_FILE))).blocks.length;
    } catch {
      // not initialized yet
    }
    return { ...meta, id, kind, sections, updatedAt: new Date(await latestMtime(dir)).toISOString() };
  }

  async list(kind: NotebookKind): Promise<ProjectSummary[]> {
    const out: ProjectSummary[] = [];
    for (const e of await readdir(join(this.root, kind), { withFileTypes: true })) {
      if (!e.isDirectory() || !ProjectIdSchema.safeParse(e.name).success) continue;
      const dir = join(this.root, kind, e.name);
      if (!existsSync(join(dir, NOTEBOOK_FILE)) && !existsSync(join(dir, PROJECT_FILE))) continue;
      out.push(await this.summary(kind, e.name));
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Creates an empty project/template, or a copy of `body.from` (without comments). */
  create(kind: NotebookKind, body: CreateProjectBody): Promise<ProjectSummary> {
    return this.mutex.run(async () => {
      const base = slugify(body.name, kind === "projects" ? "project" : "template").slice(0, 60);
      let id = base;
      for (let i = 2; existsSync(join(this.root, kind, id)); i++) id = `${base}-${i}`;
      const dir = this.dir(kind, id);
      let createdFrom: ProjectMeta["createdFrom"];
      if (body.from) {
        const src = this.dir(body.from.kind, body.from.id);
        if (!existsSync(join(src, NOTEBOOK_FILE))) throw notFound(`${body.from.kind === "projects" ? "Project" : "Template"} ${body.from.id}`);
        const srcMeta = await this.meta(body.from.kind, body.from.id);
        await cp(src, dir, {
          recursive: true,
          filter: (p) => !isCommentsFile(p) && basename(p) !== PROJECT_FILE && !basename(p).includes(".tmp"),
        });
        createdFrom = { kind: body.from.kind, id: body.from.id, name: srcMeta.name };
      } else {
        await mkdir(dir, { recursive: true });
      }
      const meta: ProjectMeta = {
        name: body.name.trim(),
        description: body.description ?? "",
        createdAt: new Date().toISOString(),
        ...(createdFrom ? { createdFrom } : {}),
      };
      await writeJsonAtomic(join(dir, PROJECT_FILE), meta);
      await this.open(kind, id); // initializes notebook.json and blocks/ for new ones
      return this.summary(kind, id);
    });
  }

  update(kind: NotebookKind, id: string, body: UpdateProjectBody): Promise<ProjectSummary> {
    return this.mutex.run(async () => {
      await this.summary(kind, id); // 404 if missing
      const meta = await this.meta(kind, id);
      if (body.name !== undefined) meta.name = body.name.trim();
      if (body.description !== undefined) meta.description = body.description;
      await writeJsonAtomic(join(this.dir(kind, id), PROJECT_FILE), meta);
      const ctx = await this.open_.get(`${kind}/${id}`);
      if (ctx) ctx.store.displayName = meta.name;
      return this.summary(kind, id);
    });
  }

  delete(kind: NotebookKind, id: string): Promise<void> {
    return this.mutex.run(async () => {
      await this.summary(kind, id);
      this.open_.delete(`${kind}/${id}`);
      await rm(this.dir(kind, id), { recursive: true, force: true });
    });
  }

  /** Files of a project/template for an archive (relative paths), without comments and temp files. */
  async archiveFiles(kind: NotebookKind, id: string): Promise<{ name: string; abs: string }[]> {
    await this.summary(kind, id); // 404 if missing
    const root = this.dir(kind, id);
    const out: { name: string; abs: string }[] = [];
    const walk = async (rel: string) => {
      for (const e of (await readdir(join(root, rel), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.name.startsWith(".tmp") || e.name.endsWith(".tmp") || isCommentsFile(e.name)) continue;
        if (e.isDirectory()) await walk(r);
        else if (e.isFile()) out.push({ name: r, abs: join(root, r) });
      }
    };
    await walk("");
    return out;
  }

  /** Validates a template archive (see templateArchive.ts); nothing is written. */
  validateTemplateArchive(data: Uint8Array, fallbackName?: string): ArchiveValidation {
    return validateTemplateArchive(data, this.registry, fallbackName);
  }

  /** Imports a validated archive as a new template (staged in a hidden folder, then renamed into place). */
  importTemplate(validation: Extract<ArchiveValidation, { ok: true }>, name?: string): Promise<ProjectSummary> {
    return this.mutex.run(async () => {
      const meta = { ...validation.meta, ...(name?.trim() ? { name: name.trim() } : {}) };
      const base = slugify(meta.name, "template").slice(0, 60);
      let id = base;
      for (let i = 2; existsSync(join(this.root, "templates", id)); i++) id = `${base}-${i}`;
      const staging = join(this.root, "templates", `.import-${Date.now().toString(36)}`);
      try {
        for (const [rel, bytes] of validation.files) {
          const target = join(staging, ...rel.split("/"));
          await mkdir(join(target, ".."), { recursive: true });
          await writeFile(target, bytes);
        }
        await writeJsonAtomic(join(staging, PROJECT_FILE), meta);
        await mkdir(join(staging, "blocks"), { recursive: true });
        // Final check: the store must be able to open it.
        await NotebookStore.open(staging, this.registry);
        await rename(staging, this.dir("templates", id));
      } catch (e) {
        await rm(staging, { recursive: true, force: true });
        throw e;
      }
      return this.summary("templates", id);
    });
  }

  /** Opens (once, then cached) the notebook of a project/template. */
  open(kind: NotebookKind, id: string): Promise<NotebookContext> {
    const key = `${kind}/${id}`;
    let ctx = this.open_.get(key);
    if (!ctx) {
      const dir = this.dir(kind, id);
      ctx = (async () => {
        if (!existsSync(dir)) throw notFound(`${kind === "projects" ? "Project" : "Template"} ${id}`);
        const store = await NotebookStore.open(dir, this.registry);
        store.displayName = (await this.meta(kind, id)).name;
        const refs = new ReferencesStore(dir);
        refs.onChange = () => store.notify({ type: "references" });
        return { kind, id, store, refs };
      })();
      this.open_.set(key, ctx);
      ctx.catch(() => this.open_.delete(key));
    }
    return ctx;
  }
}

export { HttpError };
