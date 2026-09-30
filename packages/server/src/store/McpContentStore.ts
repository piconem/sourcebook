import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CONVERTIBLE_FORMATS,
  IMAGE_ONLY_KINDS,
  MCP_CONVERSION_REVISION,
  McpManifestSchema,
  extOfName,
  mcpKindOf,
  replacePart,
  type ConvertibleExt,
  type McpContent,
  type McpInfo,
  type McpManifest,
} from "@sourcebook/shared";
import { assembleMarkdown } from "../convert/index.js";
import { convertInWorker, renderInWorker } from "../convert/pool.js";
import { badRequest, notFound } from "../errors.js";
import { writeJsonAtomic } from "../fs/atomic.js";
import { Mutex } from "../fs/mutex.js";
import { requestContext } from "../requestContext.js";

/** Hidden folder (inside references/) holding the generated content of each file. */
export const MCP_DIR = ".mcp";
/** Pages rendered automatically per document (scans, diagrams); more on request. */
const AUTO_IMAGE_LIMIT = 200;
/** Larger files are not converted automatically (they can be converted on request). */
const AUTO_MAX_BYTES = 200 * 1024 * 1024;

const pageFile = (n: number) => `pages/p${String(n).padStart(3, "0")}.webp`;

/**
 * Converted content of the reference files of one project: references/.mcp/<file path>/ with content.md,
 * manifest.json and pages/*.webp. Conversions run one at a time; files needing one are converted in the
 * background (automatic), or on request.
 */
export class McpContentStore {
  private mutex = new Mutex();
  private manifests = new Map<string, McpManifest | null>();
  private queue: string[] = [];
  private queued = new Set<string>();
  private running: string | null = null;
  private draining = false;
  /** Set to false to disable background conversions (tests). */
  auto = true;

  constructor(
    private readonly refsDir: string,
    /** Called when content changes (a conversion finished): wired to live events. */
    private readonly onChange: () => void,
  ) {}

  private dir(path: string) {
    return join(this.refsDir, MCP_DIR, ...path.split("/"));
  }
  private src(path: string) {
    return join(this.refsDir, ...path.split("/"));
  }

  private async manifest(path: string): Promise<McpManifest | null> {
    if (this.manifests.has(path)) return this.manifests.get(path)!;
    let m: McpManifest | null = null;
    try {
      const parsed = McpManifestSchema.safeParse(JSON.parse(await readFile(join(this.dir(path), "manifest.json"), "utf8")));
      m = parsed.success ? parsed.data : null;
    } catch {
      m = null;
    }
    this.manifests.set(path, m);
    return m;
  }

  /** MCP status of a file (from its name and, for documents, its stored conversion). */
  async info(path: string, st?: { size: number; mtimeMs: number }): Promise<McpInfo> {
    const kind = mcpKindOf(path);
    if (kind === "text") return { status: "native", kind: "text" };
    if (kind === "image") return { status: "native", kind: "image" };
    if (kind === "unsupported") return { status: "unsupported", kind: "none" };
    const unit = CONVERTIBLE_FORMATS[extOfName(path) as ConvertibleExt].unit;
    if (this.running === path) return { status: "converting", kind: "markdown", unit };
    const m = await this.manifest(path);
    if (this.queued.has(path)) return { status: "pending", kind: "markdown", unit, parts: m?.parts.length };
    if (!m) return { status: "pending", kind: "markdown", unit };
    const s = st ?? (await stat(this.src(path)));
    const changed = m.source.size !== s.size || Math.abs(m.source.mtimeMs - s.mtimeMs) > 1 || (m.revision ?? 1) < MCP_CONVERSION_REVISION;
    if (m.error) return { status: changed ? "pending" : "failed", kind: "markdown", unit, error: m.error };
    return {
      status: changed ? "stale" : "ready",
      kind: "markdown",
      unit: m.unit,
      parts: m.parts.length,
      pageImages: m.parts.filter((p) => p.image).length,
      figures: m.parts.reduce((sum, p) => sum + (p.figures?.length ?? 0), 0) || undefined,
      imageOnlyParts: m.parts.filter((p) => p.needsImage && !p.transcribed).length,
    };
  }

  /** Queues files for background conversion (missing, stale, or changed since a failure). */
  schedule(paths: string[]) {
    if (!this.auto) return;
    for (const p of paths) if (!this.queued.has(p) && this.running !== p) (this.queue.push(p), this.queued.add(p));
    // Background work is not part of the request that queued it: its live events come from "server",
    // so the window that caused it refreshes too (a window ignores its own events).
    requestContext.exit(() => void this.drain());
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const path = this.queue.shift()!;
        this.queued.delete(path);
        try {
          const st = await stat(this.src(path)).catch(() => null);
          if (!st?.isFile() || st.size > AUTO_MAX_BYTES) continue;
          const info = await this.info(path, st);
          if (info.status !== "pending" && info.status !== "stale") continue;
          await this.convert(path);
        } catch {
          // recorded in the manifest (failed) or the file is gone
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /** Converts a file now (unless up to date and not forced). Failures are recorded, not thrown. */
  convert(path: string, opts: { force?: boolean } = {}): Promise<McpInfo> {
    return this.mutex.run(async () => {
      if (mcpKindOf(path) !== "convertible") return this.info(path);
      // Converted now: no longer waiting in the background queue.
      if (this.queued.delete(path)) this.queue = this.queue.filter((p) => p !== path);
      const abs = this.src(path);
      const st = await stat(abs).catch(() => null);
      if (!st?.isFile()) throw notFound(`Reference ${path}`);
      if (!opts.force) {
        const current = await this.info(path, st);
        if (current.status === "ready") return current;
      }
      this.running = path;
      this.onChange();
      const dir = this.dir(path);
      const data = new Uint8Array(await readFile(abs));
      const source = { path, size: st.size, mtimeMs: st.mtimeMs, sha256: createHash("sha256").update(data).digest("hex") };
      const ext = extOfName(path);
      let manifest: McpManifest;
      try {
        const conv = await convertInWorker(data, path);
        await rm(dir, { recursive: true, force: true });
        await mkdir(dir, { recursive: true });
        for (const [rel, bytes] of Object.entries(conv.files ?? {})) {
          await mkdir(dirname(join(dir, rel)), { recursive: true });
          await writeFile(join(dir, rel), bytes);
        }
        const markdown = assembleMarkdown(path.split("/").pop()!, ext, conv);
        await writeFile(join(dir, "content.md"), markdown);
        manifest = {
          version: 1,
          revision: MCP_CONVERSION_REVISION,
          source,
          format: ext,
          converter: conv.converter,
          createdAt: new Date().toISOString(),
          unit: conv.unit,
          parts: conv.parts.map((p) => ({
            n: p.n,
            title: p.title,
            kind: p.kind,
            needsImage: p.needsImage,
            chars: p.markdown.replace(/\s/g, "").length,
            imageCoverage: p.imageCoverage,
            vector: p.vector,
            invisibleText: p.invisibleText,
            garbled: p.garbled,
            figures: p.figures?.length ? p.figures : undefined,
          })),
          warnings: conv.warnings,
        };
        // Pages whose content is only in their image: render them now.
        if (ext === "pdf") {
          const wanted = manifest.parts.filter((p) => p.needsImage).map((p) => p.n);
          if (wanted.length > AUTO_IMAGE_LIMIT) manifest.warnings.push(`Page images rendered for the first ${AUTO_IMAGE_LIMIT} of ${wanted.length} pages without text.`);
          await this.writePageImages(dir, data, manifest, wanted.slice(0, AUTO_IMAGE_LIMIT));
        }
      } catch (e) {
        await rm(dir, { recursive: true, force: true });
        await mkdir(dir, { recursive: true });
        const unit = CONVERTIBLE_FORMATS[ext as ConvertibleExt].unit;
        manifest = { version: 1, revision: MCP_CONVERSION_REVISION, source, format: ext, converter: "-", createdAt: new Date().toISOString(), unit, parts: [], warnings: [], error: (e as Error).message || String(e) };
      } finally {
        this.running = null;
      }
      await writeJsonAtomic(join(dir, "manifest.json"), manifest);
      this.manifests.set(path, manifest);
      this.onChange();
      return this.info(path, st);
    });
  }

  private async writePageImages(dir: string, data: Uint8Array, manifest: McpManifest, pages: number[]) {
    if (!pages.length) return;
    const images = await renderInWorker(data, pages);
    await mkdir(join(dir, "pages"), { recursive: true });
    for (const [n, bytes] of images) {
      await writeFile(join(dir, pageFile(n)), bytes);
      const part = manifest.parts.find((p) => p.n === n);
      if (part) part.image = pageFile(n);
    }
  }

  /** Renders page images of a converted PDF ("all" or some pages); converts first if needed. */
  async renderPages(path: string, pages: "all" | number[]): Promise<McpManifest> {
    if (extOfName(path) !== "pdf") throw badRequest("Page images are available for PDF files");
    const info = await this.convert(path);
    if (info.status === "failed") throw badRequest(`The file could not be converted: ${info.error}`);
    return this.mutex.run(async () => {
      const m = (await this.manifest(path))!;
      const wanted = (pages === "all" ? m.parts.map((p) => p.n) : pages).filter((n) => m.parts.some((p) => p.n === n && !p.image));
      if (wanted.length) {
        await this.writePageImages(this.dir(path), new Uint8Array(await readFile(this.src(path))), m, wanted);
        await writeJsonAtomic(join(this.dir(path), "manifest.json"), m);
        this.onChange();
      }
      return m;
    });
  }

  /** Stored content (manifest + Markdown); null when not converted. */
  async content(path: string): Promise<McpContent | null> {
    const m = await this.manifest(path);
    if (!m) return null;
    const markdown = m.error ? "" : await readFile(join(this.dir(path), "content.md"), "utf8").catch(() => "");
    return { manifest: m, markdown };
  }

  /** Absolute path of a page image, if rendered. */
  async pageImage(path: string, n: number): Promise<string | null> {
    const part = (await this.manifest(path))?.parts.find((p) => p.n === n);
    return part?.image && existsSync(join(this.dir(path), part.image)) ? join(this.dir(path), part.image) : null;
  }

  /** Absolute path of a figure image by its id ("p3-1"). */
  async figureImage(path: string, id: string): Promise<string | null> {
    const fig = (await this.manifest(path))?.parts.flatMap((p) => p.figures ?? []).find((f) => f.id === id);
    return fig && existsSync(join(this.dir(path), fig.image)) ? join(this.dir(path), fig.image) : null;
  }

  /** Replaces the text of a page/part with a transcription (e.g. written by the assistant from its image). */
  saveTranscription(path: string, n: number, markdown: string, by: string): Promise<McpManifest> {
    return this.mutex.run(async () => {
      const m = await this.manifest(path);
      if (!m || m.error) throw badRequest(`${path} has no converted content`);
      const part = m.parts.find((p) => p.n === n);
      if (!part) throw badRequest(`${path} has no ${m.unit} ${n}`);
      const file = join(this.dir(path), "content.md");
      const note = `_Transcribed by ${by} from the ${m.unit} image._`;
      await writeFile(file, replacePart(await readFile(file, "utf8"), n, `${note}\n\n${markdown}`));
      part.transcribed = { at: new Date().toISOString(), by };
      part.chars = markdown.replace(/\s/g, "").length;
      await writeJsonAtomic(join(this.dir(path), "manifest.json"), m);
      this.onChange();
      return m;
    });
  }

  /** Deletes the generated content of files (or everything under folders). */
  remove(paths: string[]): Promise<void> {
    return this.mutex.run(async () => {
      for (const p of paths) {
        await rm(this.dir(p), { recursive: true, force: true });
        for (const k of [...this.manifests.keys()]) if (k === p || k.startsWith(`${p}/`)) this.manifests.delete(k);
      }
    });
  }

  /** A file or folder was renamed: its generated content follows. */
  move(from: string, to: string): Promise<void> {
    return this.mutex.run(async () => {
      const src = this.dir(from);
      if (!existsSync(src)) return;
      await mkdir(dirname(this.dir(to)), { recursive: true });
      await rm(this.dir(to), { recursive: true, force: true });
      await rename(src, this.dir(to));
      for (const k of [...this.manifests.keys()]) if (k === from || k.startsWith(`${from}/`)) this.manifests.delete(k);
      // Manifests record the source path.
      const walk = async (dir: string, rel: string): Promise<void> => {
        const manifestPath = join(dir, "manifest.json");
        if (existsSync(manifestPath)) {
          const m = JSON.parse(await readFile(manifestPath, "utf8"));
          m.source.path = rel;
          await writeJsonAtomic(manifestPath, m);
        }
        for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
          if (e.isDirectory() && e.name !== "pages") await walk(join(dir, e.name), `${rel}/${e.name}`);
        }
      };
      await walk(this.dir(to), to);
    });
  }
}
