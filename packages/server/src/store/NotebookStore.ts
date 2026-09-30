import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, posix } from "node:path";
import { nanoid } from "nanoid";
import {
  BlockMetaSchema,
  CommentsFileSchema,
  type Author,
  type Comment,
  type AnchorInput,
  type AnchorText,
  type CommentView,
  createAnchor,
  resolveAnchor,
  sourceAnchorText,
  type CommentReply,
  type CommentsFile,
  NotebookIndexSchema,
  type AssetFile,
  type Block,
  type BlockDeletionImpact,
  type BlockMeta,
  type CreateBlockBody,
  type CreateSubBlockBody,
  type DeleteSubBlockResult,
  type NotebookEvent,
  type TextEdit,
  type NotebookEntry,
  type NotebookIndex,
  type Project,
  type Registry,
  type ReorderBlocksBody,
  type SubBlockRef,
  type SubBlockTypeCore,
  type UpdateBlockBody,
  type UpdateSubBlockBody,
  type BibUsage,
  citedKeys,
  isUnderReference,
  linkedReferences,
  movedReferencePath,
  renameReferenceLinks,
  outlineNumbers,
  renameCitations,
  withDepth,
} from "@sourcebook/shared";
import { HttpError, badRequest, notFound } from "../errors.js";
import { currentOrigin } from "../requestContext.js";
import { readJson, writeFileAtomic, writeJsonAtomic } from "../fs/atomic.js";
import { Mutex } from "../fs/mutex.js";
import { blockFolderName, subBlockBaseName } from "../fs/names.js";

export const NOTEBOOK_FILE = "notebook.json";
export const BLOCKS_DIR = "blocks";
export const SUBBLOCKS_DIR = "subblocks";
export const ASSETS_DIR = "assets";

/** `<source base>.comments.json`, next to the sub-block's source file. */
export const commentsFileName = (ref: SubBlockRef) =>
  `${ref.source.slice(0, -extname(ref.source).length)}.comments.json`;

/**
 * Current time as ISO string, strictly after the latest existing entry, so insertion order and
 * timestamp order always agree (two comments within the same millisecond stay ordered).
 */
function timestamp(existing: { createdAt: string }[]): string {
  const now = Date.now();
  const last = existing.reduce((max, e) => Math.max(max, Date.parse(e.createdAt) || 0), 0);
  return new Date(Math.max(now, last + 1)).toISOString();
}

/** Blank optional text is stored as absent (the key disappears from the JSON file). */
const optionalText = (s: string | undefined) => (s?.trim() ? s.trim() : undefined);

type TypeRegistry = Registry<SubBlockTypeCore<any>>;
type Placement = { id: string; parentId: string | null };

/**
 * Filesystem-backed source of truth for a Sourcebook project.
 * Keeps an in-memory copy of notebook.json / block.json files and writes through on every mutation.
 * All mutations run through a mutex, so folder renumbering never interleaves.
 */
export class NotebookStore {
  private index: NotebookIndex = { version: 1, blocks: [] };
  private metas = new Map<string, BlockMeta>();
  private mutex = new Mutex();
  /** Display name (from project.json); defaults to the folder name. */
  displayName: string;
  /** Emits "event" (NotebookEvent) after every successful change, for live updates of open editors. */
  readonly events = new EventEmitter().setMaxListeners(100);

  notify(event: Omit<NotebookEvent, "origin">) {
    this.events.emit("event", { ...event, origin: currentOrigin() } satisfies NotebookEvent);
  }

  private constructor(
    readonly root: string,
    readonly registry: TypeRegistry,
  ) {
    this.displayName = basename(root);
  }

  static async open(root: string, registry: TypeRegistry): Promise<NotebookStore> {
    const store = new NotebookStore(root, registry);
    await store.load();
    return store;
  }

  // ---------------------------------------------------------------- reading

  private async load() {
    await mkdir(join(this.root, BLOCKS_DIR), { recursive: true });
    const indexPath = join(this.root, NOTEBOOK_FILE);
    if (!existsSync(indexPath)) await writeJsonAtomic(indexPath, this.index);
    this.index = NotebookIndexSchema.parse(await readJson(indexPath));
    for (const entry of this.index.blocks) {
      const meta = BlockMetaSchema.parse(await readJson(this.blockJsonPath(entry.folder)));
      this.metas.set(meta.id, meta);
    }
  }

  getProject(): Project {
    return {
      name: this.displayName,
      blocks: this.index.blocks.map((e) => ({ ...e, subBlocks: this.meta(e.id).subBlocks })),
    };
  }

  async getBlock(id: string): Promise<Block> {
    const entry = this.entry(id);
    const meta = this.meta(id);
    const subBlocks = await Promise.all(
      meta.subBlocks.map(async (ref) => ({
        ...ref,
        rev: ref.rev ?? 0,
        content: await this.readContent(entry.folder, ref),
        commentCount: (await this.readComments(entry.folder, ref)).comments.length,
      })),
    );
    return {
      id,
      title: meta.title,
      objective: meta.objective,
      citations: meta.citations,
      references: meta.references,
      parentId: meta.parentId,
      order: meta.order,
      folder: entry.folder,
      subBlocks,
    };
  }

  // ---------------------------------------------------------------- bibliography links

  /** Associates bibliography keys with a whole section (replaces the list; [] removes all). */
  setSectionCitations(blockId: string, keys: string[]): Promise<string[]> {
    return this.mutex.run(async () => {
      const entry = this.entry(blockId);
      const meta = this.meta(blockId);
      meta.citations = keys.length ? [...new Set(keys)] : undefined;
      await writeJsonAtomic(this.blockJsonPath(entry.folder), meta);
      this.notify({ type: "block", blockId });
      return meta.citations ?? [];
    });
  }

  /** Associates bibliography keys with a whole sub-block (replaces the list). */
  setSubBlockCitations(blockId: string, subBlockId: string, keys: string[]): Promise<string[]> {
    return this.mutex.run(async () => {
      const entry = this.entry(blockId);
      const meta = this.meta(blockId);
      const ref = this.subRef(meta, subBlockId);
      ref.citations = keys.length ? [...new Set(keys)] : undefined;
      await writeJsonAtomic(this.blockJsonPath(entry.folder), meta);
      this.notify({ type: "block", blockId, subBlockId });
      return ref.citations ?? [];
    });
  }

  /** Where a bibliography key is used: associated sections/sub-blocks and sub-blocks citing it in their text. */
  async citationUsages(key?: string): Promise<(BibUsage & { key: string })[]> {
    const numbers = outlineNumbers(withDepth(this.index.blocks));
    const out: (BibUsage & { key: string })[] = [];
    for (const entry of this.index.blocks) {
      const meta = this.meta(entry.id);
      const num = numbers.get(entry.id);
      for (const k of meta.citations ?? []) if (!key || k === key) out.push({ key: k, kind: "section", blockId: entry.id, ref: `§${num}`, title: meta.title });
      for (const [i, ref] of meta.subBlocks.entries()) {
        const label = `§${num}#${i + 1}`;
        const title = ref.title ?? `${ref.type} ${i + 1}`;
        for (const k of ref.citations ?? []) if (!key || k === key) out.push({ key: k, kind: "subblock", blockId: entry.id, subBlockId: ref.id, ref: label, title });
        const source = await this.sourceText(entry.folder, ref);
        for (const k of source ? citedKeys(source) : []) if (!key || k === key) out.push({ key: k, kind: "text", blockId: entry.id, subBlockId: ref.id, ref: label, title });
      }
    }
    return out;
  }

  /** Renames a key in associations and in every bib: link of the sources (content changes bump rev). */
  renameCitationKey(oldKey: string, newKey: string): Promise<void> {
    return this.mutex.run(async () => {
      for (const entry of this.index.blocks) {
        const meta = this.meta(entry.id);
        let metaChanged = false;
        const swap = (list?: string[]) => {
          if (!list?.includes(oldKey)) return list;
          metaChanged = true;
          return [...new Set(list.map((k) => (k === oldKey ? newKey : k)))];
        };
        meta.citations = swap(meta.citations);
        for (const ref of meta.subBlocks) {
          ref.citations = swap(ref.citations);
          const source = await this.sourceText(entry.folder, ref);
          if (source && citedKeys(source).includes(oldKey)) {
            const def = this.typeOf(ref.type);
            const content = def.deserialize(renameCitations(source, oldKey, newKey), undefined, { sourceExt: extname(ref.source).slice(1) });
            await this.applySubBlockUpdate(entry.id, ref.id, { content });
          }
        }
        if (metaChanged) {
          await writeJsonAtomic(this.blockJsonPath(entry.folder), meta);
          this.notify({ type: "block", blockId: entry.id });
        }
      }
    });
  }

  /** Removes a key from every association (bib: links in text are left as they are). */
  removeCitationKey(key: string): Promise<void> {
    return this.mutex.run(async () => {
      for (const entry of this.index.blocks) {
        const meta = this.meta(entry.id);
        let changed = false;
        const drop = (list?: string[]) => {
          if (!list?.includes(key)) return list;
          changed = true;
          const rest = list.filter((k) => k !== key);
          return rest.length ? rest : undefined;
        };
        meta.citations = drop(meta.citations);
        for (const ref of meta.subBlocks) ref.citations = drop(ref.citations);
        if (changed) {
          await writeJsonAtomic(this.blockJsonPath(entry.folder), meta);
          this.notify({ type: "block", blockId: entry.id });
        }
      }
    });
  }

  // ---------------------------------------------------------------- reference file links

  /** Associates reference files with a whole section, or a sub-block (replaces the list; [] removes all). */
  setReferences(blockId: string, subBlockId: string | null, paths: string[]): Promise<string[]> {
    return this.mutex.run(async () => {
      const entry = this.entry(blockId);
      const meta = this.meta(blockId);
      const target = subBlockId ? this.subRef(meta, subBlockId) : meta;
      target.references = paths.length ? [...new Set(paths)] : undefined;
      await writeJsonAtomic(this.blockJsonPath(entry.folder), meta);
      this.notify({ type: "block", blockId, ...(subBlockId ? { subBlockId } : {}) });
      return target.references ?? [];
    });
  }

  /** Adds reference files to those attached to a section or sub-block (keeping the others). */
  async attachReferences(blockId: string, subBlockId: string | null, paths: string[]): Promise<string[]> {
    const meta = this.meta(blockId);
    const current = (subBlockId ? this.subRef(meta, subBlockId).references : meta.references) ?? [];
    return this.setReferences(blockId, subBlockId, [...current, ...paths]);
  }

  /** Where reference files are used: associated sections/sub-blocks and Markdown links (optionally for one path). */
  async referenceUsages(path?: string): Promise<(Omit<BibUsage, "kind"> & { kind: BibUsage["kind"]; path: string })[]> {
    const numbers = outlineNumbers(withDepth(this.index.blocks));
    const out: (Omit<BibUsage, "kind"> & { kind: BibUsage["kind"]; path: string })[] = [];
    const wanted = (p: string) => !path || isUnderReference(p, path);
    for (const entry of this.index.blocks) {
      const meta = this.meta(entry.id);
      const num = numbers.get(entry.id);
      for (const p of meta.references ?? []) if (wanted(p)) out.push({ path: p, kind: "section", blockId: entry.id, ref: `§${num}`, title: meta.title });
      for (const [i, ref] of meta.subBlocks.entries()) {
        const label = `§${num}#${i + 1}`;
        const title = ref.title ?? `${ref.type} ${i + 1}`;
        for (const p of ref.references ?? []) if (wanted(p)) out.push({ path: p, kind: "subblock", blockId: entry.id, subBlockId: ref.id, ref: label, title });
        if (ref.type !== "markdown") continue;
        const source = await this.sourceText(entry.folder, ref);
        for (const p of source ? linkedReferences(source) : []) if (wanted(p)) out.push({ path: p, kind: "text", blockId: entry.id, subBlockId: ref.id, ref: label, title });
      }
    }
    return out;
  }

  /** A reference file or folder was renamed: associations and Markdown links follow (content changes bump rev). */
  renameReferencePath(from: string, to: string): Promise<void> {
    return this.mutex.run(async () => {
      for (const entry of this.index.blocks) {
        const meta = this.meta(entry.id);
        let metaChanged = false;
        const move = (list?: string[]) => {
          if (!list?.some((p) => movedReferencePath(p, from, to) !== null)) return list;
          metaChanged = true;
          return [...new Set(list.map((p) => movedReferencePath(p, from, to) ?? p))];
        };
        meta.references = move(meta.references);
        for (const ref of meta.subBlocks) {
          ref.references = move(ref.references);
          if (ref.type !== "markdown") continue;
          const source = await this.sourceText(entry.folder, ref);
          if (!source) continue;
          const next = renameReferenceLinks(source, from, to);
          if (next !== source) {
            const content = this.typeOf(ref.type).deserialize(next, undefined, { sourceExt: extname(ref.source).slice(1) });
            await this.applySubBlockUpdate(entry.id, ref.id, { content });
          }
        }
        if (metaChanged) {
          await writeJsonAtomic(this.blockJsonPath(entry.folder), meta);
          this.notify({ type: "block", blockId: entry.id });
        }
      }
    });
  }

  /** Reference files/folders were deleted: drop their associations (links in text are left, shown as missing). */
  removeReferencePaths(paths: string[]): Promise<void> {
    return this.mutex.run(async () => {
      const gone = (p: string) => paths.some((r) => isUnderReference(p, r));
      for (const entry of this.index.blocks) {
        const meta = this.meta(entry.id);
        let changed = false;
        const drop = (list?: string[]) => {
          if (!list?.some(gone)) return list;
          changed = true;
          const rest = list.filter((p) => !gone(p));
          return rest.length ? rest : undefined;
        };
        meta.references = drop(meta.references);
        for (const ref of meta.subBlocks) ref.references = drop(ref.references);
        if (changed) {
          await writeJsonAtomic(this.blockJsonPath(entry.folder), meta);
          this.notify({ type: "block", blockId: entry.id });
        }
      }
    });
  }

  /** Source text of a sub-block (what the type serializes to), null if unreadable. */
  private async sourceText(folder: string, ref: SubBlockRef): Promise<string | null> {
    try {
      return this.typeOf(ref.type).serialize(await this.readContent(folder, ref)).source;
    } catch {
      return null;
    }
  }

  /** Depth of a block in the outline (0 = top level). */
  depth(id: string): number {
    let d = 0;
    for (let p = this.entry(id).parentId; p; p = this.entry(p).parentId) d++;
    return d;
  }

  blockDir(id: string): string {
    return join(this.root, BLOCKS_DIR, this.entry(id).folder);
  }

  async readContent(folder: string, ref: SubBlockRef): Promise<unknown> {
    const def = this.typeOf(ref.type);
    const source = await readFile(join(this.root, BLOCKS_DIR, folder, SUBBLOCKS_DIR, ref.source), "utf8");
    return def.deserialize(source, undefined, { sourceExt: extname(ref.source).slice(1) });
  }

  // ---------------------------------------------------------------- blocks

  createBlock(body: CreateBlockBody): Promise<NotebookEntry> {
    return this.mutex.run(async () => {
      const parentId = body.parentId ?? null;
      if (parentId) this.entry(parentId);
      const id = nanoid(10);
      const meta: BlockMeta = { id, title: body.title, parentId, order: 0, subBlocks: [] };
      // Created under a temporary folder, then placed by the renumbering pass.
      const folder = `.new-${id}`;
      await mkdir(join(this.root, BLOCKS_DIR, folder, SUBBLOCKS_DIR), { recursive: true });
      await writeJsonAtomic(this.blockJsonPath(folder), meta);
      this.metas.set(id, meta);

      const children = this.childrenMap();
      const siblings = children.get(parentId) ?? [];
      siblings.splice(Math.min(body.position ?? siblings.length, siblings.length), 0, id);
      children.set(parentId, siblings);
      const entries = [...this.index.blocks, { id, title: body.title, parentId, order: 0, folder }];
      await this.applyLayout(this.flatten(children), entries);
      this.notify({ type: "blocks", blockId: id });
      return this.entry(id);
    });
  }

  updateBlock(id: string, body: UpdateBlockBody): Promise<NotebookEntry> {
    return this.mutex.run(async () => {
      const entry = this.entry(id);
      const meta = this.meta(id);
      if (body.title !== undefined) {
        entry.title = body.title;
        meta.title = body.title;
      }
      if (body.objective !== undefined) meta.objective = optionalText(body.objective);
      const children = this.childrenMap();
      if (body.parentId !== undefined && body.parentId !== entry.parentId) {
        const parentId = body.parentId;
        if (parentId) this.assertNoCycle(id, parentId);
        children.set(entry.parentId, children.get(entry.parentId)!.filter((c) => c !== id));
        children.set(parentId, [...(children.get(parentId) ?? []), id]);
        entry.parentId = parentId;
        meta.parentId = parentId;
      }
      await this.applyLayout(this.flatten(children), this.index.blocks, new Set([id]));
      this.notify({ type: "blocks", blockId: id });
      return this.entry(id);
    });
  }

  deleteBlock(id: string): Promise<void> {
    return this.mutex.run(async () => {
      this.entry(id);
      const children = this.childrenMap();
      const doomed = new Set<string>();
      const collect = (b: string) => {
        doomed.add(b);
        (children.get(b) ?? []).forEach(collect);
      };
      collect(id);
      for (const b of doomed) {
        await rm(this.blockDir(b), { recursive: true, force: true });
        this.metas.delete(b);
        children.delete(b);
      }
      const parent = this.entry(id).parentId;
      children.set(parent, children.get(parent)!.filter((c) => c !== id));
      await this.applyLayout(
        this.flatten(children),
        this.index.blocks.filter((e) => !doomed.has(e.id)),
      );
      this.notify({ type: "blocks", blockId: id });
    });
  }

  /** Blocks (the block and its descendants) and asset files a deleteBlock(id) would remove. */
  async blockDeletionImpact(id: string): Promise<BlockDeletionImpact> {
    this.entry(id);
    const affected = [id, ...this.descendants(id)];
    const assets: string[] = [];
    for (const b of affected) {
      const dir = join(this.blockDir(b), ASSETS_DIR);
      if (!existsSync(dir)) continue;
      for (const f of (await readdir(dir)).sort()) {
        assets.push(posix.join(BLOCKS_DIR, this.entry(b).folder, ASSETS_DIR, f));
      }
    }
    return { blocks: affected.map((b) => ({ id: b, title: this.entry(b).title })), assets };
  }

  reorderBlocks(body: ReorderBlocksBody): Promise<Project> {
    return this.mutex.run(async () => {
      const ids = new Set(body.blocks.map((b) => b.id));
      if (ids.size !== body.blocks.length || ids.size !== this.index.blocks.length) {
        throw badRequest("Reorder must list every block exactly once");
      }
      for (const b of body.blocks) {
        this.entry(b.id);
        if (b.parentId && !ids.has(b.parentId)) throw badRequest(`Unknown parent ${b.parentId}`);
      }
      const parentOf = new Map(body.blocks.map((b) => [b.id, b.parentId]));
      for (const b of body.blocks) this.assertNoCycle(b.id, b.parentId, parentOf);

      const children = new Map<string | null, string[]>();
      for (const b of body.blocks) children.set(b.parentId, [...(children.get(b.parentId) ?? []), b.id]);
      const changedParents = new Set<string>();
      for (const b of body.blocks) {
        const e = this.entry(b.id);
        if (e.parentId !== b.parentId) {
          e.parentId = b.parentId;
          this.meta(b.id).parentId = b.parentId;
          changedParents.add(b.id);
        }
      }
      await this.applyLayout(this.flatten(children), this.index.blocks, changedParents);
      this.notify({ type: "blocks" });
      return this.getProject();
    });
  }

  // ---------------------------------------------------------------- sub-blocks

  addSubBlock(blockId: string, body: CreateSubBlockBody): Promise<SubBlockRef & { content: unknown }> {
    return this.mutex.run(async () => {
      const entry = this.entry(blockId);
      const meta = this.meta(blockId);
      const def = this.typeOf(body.type);
      const content = this.validateContent(def, body.content ?? def.defaultContent());
      const ref: SubBlockRef = {
        id: nanoid(10),
        type: def.type,
        order: 0,
        source: `.new-${nanoid(6)}.${this.sourceExtOf(def, content)}`,
        exports: [],
        props: body.props ?? {},
        title: optionalText(body.title),
        objective: optionalText(body.objective),
      };
      await this.writeSource(entry.folder, ref, def, content);
      const list = [...meta.subBlocks];
      list.splice(Math.min(body.position ?? list.length, list.length), 0, ref);
      await this.applySubBlockLayout(entry.folder, meta, list);
      this.notify({ type: "block", blockId, subBlockId: ref.id });
      return { ...ref, rev: 0, content };
    });
  }

  updateSubBlock(
    blockId: string,
    subBlockId: string,
    body: UpdateSubBlockBody,
  ): Promise<SubBlockRef & { content: unknown }> {
    return this.mutex.run(() => this.applySubBlockUpdate(blockId, subBlockId, body));
  }

  /** Must run inside the mutex. */
  private async applySubBlockUpdate(blockId: string, subBlockId: string, body: UpdateSubBlockBody) {
    const entry = this.entry(blockId);
    const meta = this.meta(blockId);
    const ref = this.subRef(meta, subBlockId);
    const def = this.typeOf(ref.type);
    const dir = join(this.root, BLOCKS_DIR, entry.folder, SUBBLOCKS_DIR);
    if (body.expectedRev !== undefined && body.expectedRev !== (ref.rev ?? 0)) {
      throw new HttpError(409, "The sub-block was changed in the meantime; reload it and retry", { currentRev: ref.rev ?? 0 });
    }

    let content: unknown;
    if (body.content !== undefined) {
      content = this.validateContent(def, body.content);
      const serialized = await this.writeSource(entry.folder, ref, def, content);
      // Without new exports (e.g. an edit through the API/MCP), previous exports would show stale content.
      const assets = [...(serialized.assets ?? []), ...(body.exports ?? [])];
      await this.replaceExports(dir, ref, assets);
      ref.rev = (ref.rev ?? 0) + 1;
    } else {
      content = await this.readContent(entry.folder, ref);
      if (body.exports !== undefined) await this.replaceExports(dir, ref, body.exports);
    }
    if (body.props) ref.props = body.props;
    if (body.title !== undefined) ref.title = optionalText(body.title);
    if (body.objective !== undefined) ref.objective = optionalText(body.objective);
    await writeJsonAtomic(this.blockJsonPath(entry.folder), meta);
    this.notify({ type: "subblock", blockId, subBlockId, rev: ref.rev ?? 0 });
    return { ...ref, rev: ref.rev ?? 0, content };
  }

  /**
   * Applies text edits to a sub-block's source (find/replace or line ranges, in order) atomically, then
   * validates and saves like a content update. Nothing is written if any edit fails.
   */
  editSubBlock(blockId: string, subBlockId: string, edits: TextEdit[], expectedRev?: number) {
    return this.mutex.run(async () => {
      const entry = this.entry(blockId);
      const ref = this.subRef(this.meta(blockId), subBlockId);
      const def = this.typeOf(ref.type);
      let text = def.serialize(await this.readContent(entry.folder, ref)).source;
      edits.forEach((e, i) => {
        const label = edits.length > 1 ? `Edit ${i + 1}: ` : "";
        if ("find" in e) {
          const count = text.split(e.find).length - 1;
          if (!count) throw badRequest(`${label}text not found: ${JSON.stringify(e.find.slice(0, 120))}`);
          if (count > 1 && !e.all) {
            throw badRequest(`${label}text occurs ${count} times: include more surrounding text to make it unique, or set "all"`);
          }
          text = e.all ? text.split(e.find).join(e.replace) : text.replace(e.find, () => e.replace);
        } else {
          const trailing = text.endsWith("\n");
          const lines = (trailing ? text.slice(0, -1) : text).split("\n");
          const count = text === "" ? 0 : lines.length;
          const { first, last } = e.lines;
          if (first > count + 1 || last > count) throw badRequest(`${label}lines ${first}-${last} are outside the text (${count} lines)`);
          const replacement = e.text === "" ? [] : e.text.replace(/\n$/, "").split("\n");
          const base = text === "" ? [] : lines;
          base.splice(first - 1, last - first + 1, ...replacement);
          text = base.join("\n") + (trailing || text === "" ? "\n" : "");
        }
      });
      const content = def.deserialize(text, undefined, { sourceExt: extname(ref.source).slice(1) });
      return this.applySubBlockUpdate(blockId, subBlockId, { content, expectedRev });
    });
  }

  reorderSubBlocks(blockId: string, order: string[]): Promise<SubBlockRef[]> {
    return this.mutex.run(async () => {
      const entry = this.entry(blockId);
      const meta = this.meta(blockId);
      if (new Set(order).size !== order.length || order.length !== meta.subBlocks.length) {
        throw badRequest("Reorder must list every sub-block exactly once");
      }
      const list = order.map((id) => this.subRef(meta, id));
      await this.applySubBlockLayout(entry.folder, meta, list);
      this.notify({ type: "block", blockId });
      return meta.subBlocks;
    });
  }

  /**
   * Deletes a sub-block (source + exports). With `deleteAssets`, also removes the asset files it
   * references, except those still referenced by another sub-block of the same block.
   */
  deleteSubBlock(blockId: string, subBlockId: string, deleteAssets = false): Promise<DeleteSubBlockResult> {
    return this.mutex.run(async () => {
      const entry = this.entry(blockId);
      const meta = this.meta(blockId);
      const ref = this.subRef(meta, subBlockId);
      const remaining = meta.subBlocks.filter((s) => s.id !== subBlockId);
      const result: DeleteSubBlockResult = { deletedAssets: [], keptAssets: [] };

      if (deleteAssets) {
        const referencedElsewhere = new Set<string>();
        for (const other of remaining) {
          (await this.assetsOf(entry.folder, other)).forEach((a) => referencedElsewhere.add(a));
        }
        for (const asset of await this.assetsOf(entry.folder, ref)) {
          if (referencedElsewhere.has(asset)) {
            result.keptAssets.push(asset);
            continue;
          }
          await rm(join(this.root, BLOCKS_DIR, entry.folder, asset), { force: true });
          result.deletedAssets.push(asset);
        }
      }

      const dir = join(this.root, BLOCKS_DIR, entry.folder, SUBBLOCKS_DIR);
      for (const f of [ref.source, ...ref.exports, commentsFileName(ref)]) await rm(join(dir, f), { force: true });
      await this.applySubBlockLayout(entry.folder, meta, remaining);
      this.notify({ type: "block", blockId, subBlockId });
      return result;
    });
  }

  // ---------------------------------------------------------------- assets

  saveAsset(blockId: string, ext: string, data: Uint8Array): Promise<string> {
    return this.mutex.run(async () => {
      const dir = join(this.blockDir(blockId), ASSETS_DIR);
      await mkdir(dir, { recursive: true });
      const name = `${nanoid(10)}.${ext}`;
      await writeFile(join(dir, name), data);
      this.notify({ type: "block", blockId });
      return `${ASSETS_DIR}/${name}`;
    });
  }

  /**
   * Deletes one file from a block's assets/ folder, refusing (409) while any sub-block of the
   * block still references it.
   */
  deleteAsset(blockId: string, name: string): Promise<void> {
    return this.mutex.run(async () => {
      const entry = this.entry(blockId);
      if (!/^[^/\\]+$/.test(name) || name.startsWith(".")) throw badRequest("Invalid asset name");
      const asset = `${ASSETS_DIR}/${name}`;
      const path = join(this.root, BLOCKS_DIR, entry.folder, asset);
      if (!existsSync(path)) throw notFound(`Asset ${asset}`);
      const users: string[] = [];
      for (const ref of this.meta(blockId).subBlocks) {
        if ((await this.assetsOf(entry.folder, ref)).includes(asset)) users.push(ref.id);
      }
      if (users.length) throw new HttpError(409, `${asset} is still referenced by other sub-blocks`, { subBlocks: users });
      await rm(path);
      this.notify({ type: "block", blockId });
    });
  }

  // ---------------------------------------------------------------- internals

  private entry(id: string): NotebookEntry {
    const e = this.index.blocks.find((b) => b.id === id);
    if (!e) throw notFound(`Block ${id}`);
    return e;
  }

  private meta(id: string): BlockMeta {
    const m = this.metas.get(id);
    if (!m) throw notFound(`Block ${id}`);
    return m;
  }

  private subRef(meta: BlockMeta, subBlockId: string): SubBlockRef {
    const ref = meta.subBlocks.find((s) => s.id === subBlockId);
    if (!ref) throw notFound(`Sub-block ${subBlockId}`);
    return ref;
  }

  private typeOf(type: string): SubBlockTypeCore<any> {
    const def = this.registry.get(type);
    if (!def) throw badRequest(`Unknown sub-block type "${type}"`);
    return def;
  }

  private validateContent(def: SubBlockTypeCore<any>, raw: unknown): unknown {
    const parsed = def.contentSchema.safeParse(raw);
    if (!parsed.success) throw badRequest(`Invalid ${def.type} content`, parsed.error.issues);
    const result = def.validate?.(parsed.data);
    if (result && !result.ok) throw badRequest(`Invalid ${def.type} content`, result.errors);
    return parsed.data;
  }

  private sourceExtOf(def: SubBlockTypeCore<any>, content: unknown): string {
    return def.sourceExtFor?.(content) ?? def.sourceExt;
  }

  /** Asset paths (block-relative, inside assets/) referenced by a stored sub-block. */
  private async assetsOf(folder: string, ref: SubBlockRef): Promise<string[]> {
    const def = this.typeOf(ref.type);
    if (!def.assetsOf) return [];
    return def
      .assetsOf(await this.readContent(folder, ref))
      .map((a) => posix.normalize(a))
      .filter((a) => a.startsWith(`${ASSETS_DIR}/`) && !a.includes(".."));
  }

  private descendants(id: string): string[] {
    const children = this.childrenMap();
    const out: string[] = [];
    const visit = (b: string) => (children.get(b) ?? []).forEach((c) => (out.push(c), visit(c)));
    visit(id);
    return out;
  }

  private blockJsonPath(folder: string) {
    return join(this.root, BLOCKS_DIR, folder, "block.json");
  }

  /** Writes the source file; renames it when the content implies another extension (e.g. new language). */
  private async writeSource(folder: string, ref: SubBlockRef, def: SubBlockTypeCore<any>, content: unknown) {
    const dir = join(this.root, BLOCKS_DIR, folder, SUBBLOCKS_DIR);
    const serialized = def.serialize(content);
    const ext = this.sourceExtOf(def, content);
    const current = ref.source;
    const target = current.slice(0, -extname(current).length) + "." + ext;
    if (ref.exports.includes(target)) throw badRequest(`Source extension ".${ext}" conflicts with an export`);
    await writeFileAtomic(join(dir, target), serialized.source);
    if (target !== current) {
      await rm(join(dir, current), { force: true });
      ref.source = target;
    }
    return serialized;
  }

  private async replaceExports(dir: string, ref: SubBlockRef, assets: AssetFile[]) {
    for (const f of ref.exports) await rm(join(dir, f), { force: true });
    const base = ref.source.slice(0, -extname(ref.source).length);
    const seen = new Set<string>();
    ref.exports = [];
    for (const a of assets) {
      if (seen.has(a.ext) || a.ext === extname(ref.source).slice(1)) {
        throw badRequest(`Duplicate or conflicting export extension "${a.ext}"`);
      }
      seen.add(a.ext);
      const name = `${base}.${a.ext}`;
      await writeFileAtomic(join(dir, name), Buffer.from(a.dataBase64, "base64"));
      ref.exports.push(name);
    }
  }

  /** parentId → ordered child ids, from the current index. */
  private childrenMap(): Map<string | null, string[]> {
    const map = new Map<string | null, string[]>();
    for (const e of this.index.blocks) map.set(e.parentId, [...(map.get(e.parentId) ?? []), e.id]);
    return map;
  }

  /** Depth-first flattening of the outline. */
  private flatten(children: Map<string | null, string[]>): Placement[] {
    const out: Placement[] = [];
    const visit = (parentId: string | null) => {
      for (const id of children.get(parentId) ?? []) {
        out.push({ id, parentId });
        visit(id);
      }
    };
    visit(null);
    return out;
  }

  private assertNoCycle(id: string, parentId: string | null, parentOf?: Map<string, string | null>) {
    const lookup = (b: string) => (parentOf ? parentOf.get(b) ?? null : this.entry(b).parentId);
    for (let p: string | null = parentId; p; p = lookup(p)) {
      if (p === id) throw badRequest("A block cannot be nested inside itself");
    }
  }

  /**
   * Assigns orders (1-based, depth-first) and folder names, renaming folders in two phases
   * (current → temp → final) so swapped prefixes never collide. Rewrites every block.json
   * whose metadata changed, then notebook.json.
   */
  private async applyLayout(layout: Placement[], entries: NotebookEntry[], dirty = new Set<string>()) {
    const byId = new Map(entries.map((e) => [e.id, e]));
    const blocksDir = join(this.root, BLOCKS_DIR);
    const next: NotebookEntry[] = layout.map(({ id, parentId }, i) => {
      const e = byId.get(id)!;
      return { ...e, parentId, order: i + 1, folder: blockFolderName(i + 1, this.meta(id).title) };
    });

    const moves = next.filter((n) => n.folder !== byId.get(n.id)!.folder);
    for (const n of moves) await rename(join(blocksDir, byId.get(n.id)!.folder), join(blocksDir, `.tmp-${n.id}`));
    for (const n of moves) await rename(join(blocksDir, `.tmp-${n.id}`), join(blocksDir, n.folder));

    for (const n of next) {
      const meta = this.meta(n.id);
      if (moves.includes(n) || dirty.has(n.id) || meta.order !== n.order || meta.parentId !== n.parentId) {
        meta.order = n.order;
        meta.parentId = n.parentId;
        await writeJsonAtomic(this.blockJsonPath(n.folder), meta);
      }
    }
    this.index = { version: 1, blocks: next };
    await writeJsonAtomic(join(this.root, NOTEBOOK_FILE), this.index);
  }

  /** Renumbers sub-block files (two-phase rename) to match `list` and persists block.json. */
  private async applySubBlockLayout(folder: string, meta: BlockMeta, list: SubBlockRef[]) {
    const dir = join(this.root, BLOCKS_DIR, folder, SUBBLOCKS_DIR);
    const renames: { from: string; tmp: string; to: string }[] = [];
    list.forEach((ref, i) => {
      ref.order = i + 1;
      const base = subBlockBaseName(i + 1, ref.type);
      const oldBase = ref.source.slice(0, -extname(ref.source).length);
      if (oldBase === base) return;
      const comments = commentsFileName(ref);
      const hasComments = existsSync(join(dir, comments));
      const files = [ref.source, ...ref.exports];
      ref.source = base + extname(ref.source);
      ref.exports = ref.exports.map((f) => base + extname(f));
      files.forEach((from, j) =>
        renames.push({ from, tmp: `.tmp-${ref.id}-${j}`, to: j === 0 ? ref.source : ref.exports[j - 1] }),
      );
      // The comments file follows its sub-block's numbering.
      if (hasComments) renames.push({ from: comments, tmp: `.tmp-${ref.id}-comments`, to: commentsFileName(ref) });
    });
    for (const r of renames) await rename(join(dir, r.from), join(dir, r.tmp));
    for (const r of renames) await rename(join(dir, r.tmp), join(dir, r.to));
    meta.subBlocks = list;
    await writeJsonAtomic(this.blockJsonPath(folder), meta);
  }

  // ---------------------------------------------------------------- comments

  private commentsPath(folder: string, ref: SubBlockRef) {
    return join(this.root, BLOCKS_DIR, folder, SUBBLOCKS_DIR, commentsFileName(ref));
  }

  private async readComments(folder: string, ref: SubBlockRef): Promise<CommentsFile> {
    const path = this.commentsPath(folder, ref);
    if (!existsSync(path)) return { version: 1, comments: [] };
    return CommentsFileSchema.parse(await readJson(path));
  }

  /** Writes the comments file (removed when the last comment goes), oldest first. */
  private async writeComments(folder: string, ref: SubBlockRef, file: CommentsFile) {
    const path = this.commentsPath(folder, ref);
    if (!file.comments.length) return rm(path, { force: true });
    file.comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const c of file.comments) c.replies.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    await writeJsonAtomic(path, file);
  }

  async listComments(blockId: string, subBlockId: string): Promise<CommentView[]> {
    const entry = this.entry(blockId);
    const ref = this.subRef(this.meta(blockId), subBlockId);
    const { comments } = await this.readComments(entry.folder, ref);
    if (!comments.some((c) => c.anchor)) return comments;
    return this.withResolved(comments, await this.anchorText(entry.folder, ref));
  }

  /** Anchorable text of a sub-block's current source, mapped to source lines. */
  private async anchorText(folder: string, ref: SubBlockRef): Promise<AnchorText> {
    const def = this.typeOf(ref.type);
    const source = await readFile(join(this.root, BLOCKS_DIR, folder, SUBBLOCKS_DIR, ref.source), "utf8");
    return def.anchorText?.(source) ?? sourceAnchorText(source);
  }

  /**
   * Validates an anchor for this sub-block (types declaring `commentAnchor`, matching unit) and turns a
   * line selector into a quote anchor made from the current source.
   */
  private async materializeAnchor(folder: string, ref: SubBlockRef, input: AnchorInput | undefined | null) {
    if (!input) return undefined;
    const unit = this.typeOf(ref.type).commentAnchor;
    if (!unit) throw badRequest(`${ref.type} sub-blocks only take comments on the whole sub-block`);
    if ("exact" in input) {
      if (input.unit !== unit) throw badRequest(`${ref.type} comments must be anchored by "${unit}"`);
      return input;
    }
    const at = await this.anchorText(folder, ref);
    const { first, last } = input.lines;
    if (last > at.lineCount) throw badRequest(`Lines ${first}-${last} are outside the source (${at.lineCount} lines)`);
    const range = at.rangeOfLines(first, last);
    const anchor = range && createAnchor(at.text, range.from, range.to, unit);
    if (!anchor) throw badRequest(`Lines ${first}-${last} contain no text to comment on`);
    return anchor;
  }

  /** Where each anchored comment's quote is now (source lines), or null when detached. */
  private withResolved(comments: Comment[], at: AnchorText): CommentView[] {
    return comments.map((c) => {
      if (!c.anchor) return c;
      const r = resolveAnchor(at.text, c.anchor);
      return {
        ...c,
        resolved: r ? { lines: { first: at.lineAt(r.from), last: at.lineAt(Math.max(r.from, r.to - 1)) } } : null,
      };
    });
  }

  addComment(blockId: string, subBlockId: string, author: Author, text: string, input?: AnchorInput): Promise<CommentView> {
    return this.mutex.run(async () => {
      const entry = this.entry(blockId);
      const ref = this.subRef(this.meta(blockId), subBlockId);
      const anchor = await this.materializeAnchor(entry.folder, ref, input);
      const file = await this.readComments(entry.folder, ref);
      const comment: Comment = {
        id: nanoid(10),
        author,
        createdAt: timestamp(file.comments),
        text,
        ...(anchor ? { anchor } : {}),
        replies: [],
      };
      file.comments.push(comment);
      await this.writeComments(entry.folder, ref, file);
      this.notify({ type: "comments", blockId, subBlockId });
      return anchor ? this.withResolved([comment], await this.anchorText(entry.folder, ref))[0] : comment;
    });
  }

  /** Re-attaches a comment to new text/lines, or (null) makes it a comment on the whole sub-block. */
  setCommentAnchor(blockId: string, subBlockId: string, commentId: string, input: AnchorInput | null): Promise<CommentView> {
    return this.mutex.run(async () => {
      const entry = this.entry(blockId);
      const ref = this.subRef(this.meta(blockId), subBlockId);
      const anchor = await this.materializeAnchor(entry.folder, ref, input);
      const file = await this.readComments(entry.folder, ref);
      const comment = file.comments.find((c) => c.id === commentId);
      if (!comment) throw notFound(`Comment ${commentId}`);
      if (anchor) comment.anchor = anchor;
      else delete comment.anchor;
      await this.writeComments(entry.folder, ref, file);
      this.notify({ type: "comments", blockId, subBlockId });
      return anchor ? this.withResolved([comment], await this.anchorText(entry.folder, ref))[0] : comment;
    });
  }

  addReply(blockId: string, subBlockId: string, commentId: string, author: Author, text: string): Promise<CommentReply> {
    return this.mutex.run(async () => {
      const entry = this.entry(blockId);
      const ref = this.subRef(this.meta(blockId), subBlockId);
      const file = await this.readComments(entry.folder, ref);
      const comment = file.comments.find((c) => c.id === commentId);
      if (!comment) throw notFound(`Comment ${commentId}`);
      const reply: CommentReply = { id: nanoid(10), author, createdAt: timestamp(comment.replies), text };
      comment.replies.push(reply);
      await this.writeComments(entry.folder, ref, file);
      this.notify({ type: "comments", blockId, subBlockId });
      return reply;
    });
  }

  /** Deletes a comment with its replies, or (with replyId) a single reply. */
  deleteComment(blockId: string, subBlockId: string, commentId: string, replyId?: string): Promise<void> {
    return this.mutex.run(async () => {
      const entry = this.entry(blockId);
      const ref = this.subRef(this.meta(blockId), subBlockId);
      const file = await this.readComments(entry.folder, ref);
      const comment = file.comments.find((c) => c.id === commentId);
      if (!comment) throw notFound(`Comment ${commentId}`);
      if (replyId) {
        if (!comment.replies.some((r) => r.id === replyId)) throw notFound(`Reply ${replyId}`);
        comment.replies = comment.replies.filter((r) => r.id !== replyId);
      } else {
        file.comments = file.comments.filter((c) => c.id !== commentId);
      }
      await this.writeComments(entry.folder, ref, file);
      this.notify({ type: "comments", blockId, subBlockId });
    });
  }

  /** Lists files on disk under a block folder (used by tests / diagnostics). */
  async listBlockFiles(id: string): Promise<string[]> {
    return (await readdir(join(this.blockDir(id), SUBBLOCKS_DIR))).sort();
  }
}
