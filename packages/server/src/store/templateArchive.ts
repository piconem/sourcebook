import { strFromU8, strToU8, unzipSync } from "fflate";
import { posix } from "node:path";
import {
  BlockMetaSchema,
  NotebookIndexSchema,
  ProjectMetaSchema,
  type ProjectMeta,
  type Registry,
  type SubBlockTypeCore,
} from "@sourcebook/shared";
import { z } from "zod";

export const MANIFEST_FILE = "sourcebook-template.json";
export const ARCHIVE_FORMAT = "sourcebook-template";
export const ARCHIVE_VERSION = 1;

/** Limits against oversized archives and zip bombs. */
export const LIMITS = {
  compressedBytes: 200 * 1024 * 1024,
  uncompressedBytes: 500 * 1024 * 1024,
  entries: 20_000,
};

export const ManifestSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT),
  version: z.number().int().min(1),
  exportedAt: z.string().optional(),
  template: z.object({ name: z.string().min(1), description: z.string().optional() }).optional(),
});

export interface ArchivePreview {
  name: string;
  description: string;
  sections: number;
  subBlocks: number;
  references: number;
  warnings: string[];
}

export type ArchiveValidation =
  | { ok: true; preview: ArchivePreview; meta: ProjectMeta; files: Map<string, Uint8Array> }
  | { ok: false; errors: string[]; warnings: string[] };

const IGNORED = [/^__MACOSX\//, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/, /(^|\/)desktop\.ini$/i];
const TOP_LEVEL = new Set(["notebook.json", "project.json", MANIFEST_FILE]);
const TOP_DIRS = new Set(["blocks", "references"]);

/** A safe relative archive path: no absolute paths, drive letters, backslashes, "..", empty or NUL segments. */
function unsafePath(name: string): string | null {
  if (name.includes("\\")) return "contains backslashes";
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return "is absolute";
  if (name.includes("\0")) return "contains NUL";
  const segs = name.replace(/\/$/, "").split("/");
  if (segs.some((s) => s === ".." || s === "." || s === "")) return "contains '..', '.' or empty segments";
  return null;
}

const parseJson = (bytes: Uint8Array | undefined): unknown => {
  if (!bytes) return undefined;
  return JSON.parse(strFromU8(bytes));
};

/**
 * Validates a template archive completely, without touching the filesystem. Collects every problem it can
 * find (errors block the import; warnings describe what will be ignored).
 */
export function validateTemplateArchive(
  data: Uint8Array,
  registry: Registry<SubBlockTypeCore<any>>,
  fallbackName = "Imported template",
): ArchiveValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (...e: string[]) => ({ ok: false as const, errors: [...errors, ...e], warnings });

  if (data.length > LIMITS.compressedBytes) return fail(`The archive is larger than ${LIMITS.compressedBytes / 1024 / 1024} MB.`);
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) return fail("The file is not a ZIP archive.");

  // 1. Unzip, checking sizes before inflating anything.
  let entries: Record<string, Uint8Array>;
  let total = 0;
  let count = 0;
  let tooBig = false;
  try {
    entries = unzipSync(data, {
      filter: (f) => {
        count++;
        total += f.originalSize;
        if (count > LIMITS.entries || total > LIMITS.uncompressedBytes) tooBig = true;
        return !tooBig;
      },
    });
  } catch (e) {
    return fail(`The ZIP archive is corrupted or uses an unsupported format (${(e as Error).message}).`);
  }
  if (tooBig) {
    return fail(`The archive is too large once extracted (limits: ${LIMITS.entries} files, ${LIMITS.uncompressedBytes / 1024 / 1024} MB).`);
  }

  // 2. Path safety and ignored system files.
  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(entries)) {
    const problem = unsafePath(name);
    if (problem) {
      errors.push(`Unsafe path "${name}": ${problem}.`);
      continue;
    }
    if (IGNORED.some((r) => r.test(name))) continue;
    if (name.endsWith("/")) continue; // directory entry
    files.set(name, bytes);
  }
  if (errors.length) return fail();

  // 3. Accept a template wrapped in a single top-level folder (e.g. zipped by hand).
  if (!files.has("notebook.json")) {
    const roots = new Set([...files.keys()].map((n) => n.split("/")[0]));
    const [root] = roots;
    if (roots.size === 1 && files.has(`${root}/notebook.json`)) {
      const stripped = new Map<string, Uint8Array>();
      for (const [n, b] of files) stripped.set(n.slice(root.length + 1), b);
      files.clear();
      stripped.forEach((b, n) => files.set(n, b));
    } else {
      return fail("notebook.json not found: this does not look like a Sourcebook template.");
    }
  }

  // 4. Top-level layout.
  for (const name of [...files.keys()]) {
    const top = name.split("/")[0];
    const isTop = !name.includes("/");
    if ((isTop && TOP_LEVEL.has(name)) || (!isTop && TOP_DIRS.has(top))) {
      if (name.endsWith(".comments.json")) {
        files.delete(name);
        if (!warnings.some((w) => w.startsWith("Comments"))) warnings.push("Comments are not imported.");
      } else if (/(^|\/)\.tmp-|\.tmp$/.test(name)) {
        files.delete(name);
      }
      continue;
    }
    warnings.push(`Ignored unexpected file "${name}".`);
    files.delete(name);
  }

  // 5. Manifest and metadata.
  let manifest: z.infer<typeof ManifestSchema> | undefined;
  try {
    const raw = parseJson(files.get(MANIFEST_FILE));
    if (raw !== undefined) {
      const parsed = ManifestSchema.safeParse(raw);
      if (!parsed.success) errors.push(`${MANIFEST_FILE} is not a valid Sourcebook template manifest.`);
      else if (parsed.data.version > ARCHIVE_VERSION) {
        errors.push(`The archive uses format version ${parsed.data.version}; this Sourcebook supports up to ${ARCHIVE_VERSION}.`);
      } else manifest = parsed.data;
    } else warnings.push(`No ${MANIFEST_FILE}: the archive was not exported by Sourcebook; checking its structure anyway.`);
  } catch {
    errors.push(`${MANIFEST_FILE} is not valid JSON.`);
  }
  files.delete(MANIFEST_FILE);

  let meta: ProjectMeta = {
    name: manifest?.template?.name ?? fallbackName,
    description: manifest?.template?.description ?? "",
    createdAt: new Date().toISOString(),
  };
  try {
    const raw = parseJson(files.get("project.json"));
    if (raw !== undefined) {
      const parsed = ProjectMetaSchema.safeParse(raw);
      if (parsed.success) meta = { ...parsed.data, createdAt: new Date().toISOString() };
      else errors.push("project.json is invalid (a non-empty \"name\" is required).");
    }
  } catch {
    errors.push("project.json is not valid JSON.");
  }
  delete meta.createdFrom;

  // 6. Notebook index and blocks.
  let index: z.infer<typeof NotebookIndexSchema>;
  try {
    const parsed = NotebookIndexSchema.safeParse(parseJson(files.get("notebook.json")));
    if (!parsed.success) return fail(`notebook.json is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}.`);
    index = parsed.data;
  } catch {
    return fail("notebook.json is not valid JSON.");
  }

  const ids = new Set<string>();
  const folders = new Set<string>();
  for (const e of index.blocks) {
    if (ids.has(e.id)) errors.push(`Section id "${e.id}" appears twice in notebook.json.`);
    ids.add(e.id);
    if (unsafePath(`blocks/${e.folder}`) || e.folder.includes("/")) errors.push(`Section "${e.title}" has an invalid folder name "${e.folder}".`);
    if (folders.has(e.folder)) errors.push(`Folder "${e.folder}" is used by two sections.`);
    folders.add(e.folder);
  }
  const parentOf = new Map(index.blocks.map((b) => [b.id, b.parentId]));
  for (const e of index.blocks) {
    if (e.parentId && !ids.has(e.parentId)) errors.push(`Section "${e.title}" has an unknown parent "${e.parentId}".`);
    const seen = new Set<string>();
    for (let p = e.parentId; p; p = parentOf.get(p) ?? null) {
      if (seen.has(p) || p === e.id) {
        errors.push(`Section "${e.title}" is nested inside itself.`);
        break;
      }
      seen.add(p);
    }
  }

  let subBlocks = 0;
  for (const e of index.blocks) {
    const dir = `blocks/${e.folder}`;
    let blockMeta: z.infer<typeof BlockMetaSchema>;
    try {
      const raw = parseJson(files.get(`${dir}/block.json`));
      if (raw === undefined) {
        errors.push(`Section "${e.title}": ${dir}/block.json is missing.`);
        continue;
      }
      const parsed = BlockMetaSchema.safeParse(raw);
      if (!parsed.success) {
        errors.push(`Section "${e.title}": ${dir}/block.json is invalid.`);
        continue;
      }
      blockMeta = parsed.data;
    } catch {
      errors.push(`Section "${e.title}": ${dir}/block.json is not valid JSON.`);
      continue;
    }
    if (blockMeta.id !== e.id) errors.push(`Section "${e.title}": block.json id "${blockMeta.id}" does not match notebook.json ("${e.id}").`);

    for (const ref of blockMeta.subBlocks) {
      subBlocks++;
      const where = `Section "${e.title}", sub-block ${ref.order} (${ref.type})`;
      const def = registry.get(ref.type);
      if (!def) {
        errors.push(`${where}: unknown sub-block type "${ref.type}".`);
        continue;
      }
      for (const f of [ref.source, ...ref.exports]) {
        if (f.includes("/") || unsafePath(f)) errors.push(`${where}: invalid file name "${f}".`);
        else if (!files.has(`${dir}/subblocks/${f}`)) errors.push(`${where}: file subblocks/${f} is missing.`);
      }
      const source = files.get(`${dir}/subblocks/${ref.source}`);
      if (!source) continue;
      try {
        const content = def.deserialize(strFromU8(source), undefined, { sourceExt: posix.extname(ref.source).slice(1) });
        const parsed = def.contentSchema.safeParse(content);
        const check = parsed.success ? def.validate?.(parsed.data) : undefined;
        if (!parsed.success) errors.push(`${where}: the content of ${ref.source} is not valid for this type.`);
        else if (check && !check.ok) errors.push(`${where}: ${check.errors.join("; ")}.`);
        else
          for (const asset of def.assetsOf?.(parsed.data) ?? []) {
            if (!files.has(`${dir}/${posix.normalize(asset)}`)) errors.push(`${where}: referenced file ${asset} is missing.`);
          }
      } catch (err) {
        errors.push(`${where}: ${ref.source} cannot be read (${(err as Error).message}).`);
      }
    }
  }

  // Block folders not listed in notebook.json are dropped.
  for (const name of [...files.keys()]) {
    const m = /^blocks\/([^/]+)\//.exec(name);
    if (m && !folders.has(m[1])) {
      if (!warnings.some((w) => w.includes(`blocks/${m[1]}/`))) warnings.push(`Ignored blocks/${m[1]}/: not listed in notebook.json.`);
      files.delete(name);
    }
  }

  if (errors.length) return { ok: false, errors, warnings };
  files.set("project.json", strToU8(JSON.stringify(meta, null, 2) + "\n"));
  const references = [...files.keys()].filter((n) => n.startsWith("references/")).length;
  return {
    ok: true,
    meta,
    files,
    preview: { name: meta.name, description: meta.description, sections: index.blocks.length, subBlocks, references, warnings },
  };
}
