import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  ConvertReferencesBodySchema,
  RenderPagesBodySchema,
  TranscriptionBodySchema,
  mcpKindOf,
  type ReferenceNode,
  AttachReferencesBodySchema,
  BlockIdParamsSchema,
  SubBlockParamsSchema,
  CreateReferenceFolderBodySchema,
  ReferencePathsBodySchema,
  MoveReferencesBodySchema,
  ZipReferencesBodySchema,
  ReferencePathQuerySchema,
  RenameReferenceBodySchema,
  UploadReferencesQuerySchema,
} from "@sourcebook/shared";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { createReadStream } from "node:fs";
import { PassThrough } from "node:stream";
import { basename, extname } from "node:path";
import { z } from "zod";
import { badRequest, notFound } from "../errors.js";
import { validatePath } from "../store/ReferencesStore.js";
import { UNTRUSTED_FILE_CSP } from "../securityHeaders.js";

const MAX_UPLOAD = 100 * 1024 * 1024;

/** Explicit types: the browser never sniffs, and only these are rendered inline. */
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac",
  mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime",
  html: "text/html", htm: "text/html",
};
const mimeFor = (path: string) => MIME[extname(path).slice(1).toLowerCase()] ?? "text/plain";
/** Already-compressed formats are stored as-is in archives (deflating them only costs time). */
const STORED = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp", "avif", "mp3", "mp4", "webm", "ogg", "m4a", "mov", "zip", "gz", "7z", "docx", "xlsx", "pptx", "odt"]);

const isActiveContent = (mime: string) => mime === "text/html" || mime === "image/svg+xml";

export const referenceRoutes =
  (): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/references", async (req) => req.nb.refs.tree());

    /**
     * Serves a reference inline. Unknown types are served as text/plain (never executed); HTML and SVG
     * get a sandboxing CSP (no scripts, no network). ?download=1 forces a download.
     */
    app.get(
      "/references/file/*",
      {
        schema: {
          params: z.object({ "*": z.string() }),
          querystring: z.object({ download: z.string().optional() }),
        },
      },
      async (req, reply) => {
        const path = req.params["*"];
        const { abs, size } = await req.nb.refs.file(path);
        const mime = mimeFor(path);
        const name = encodeURIComponent(basename(path));
        reply
          .header("content-type", mime.startsWith("text/") ? `${mime}; charset=utf-8` : mime)
          .header("content-length", size)
          .header("x-content-type-options", "nosniff")
          .header("cache-control", "no-cache")
          .header(
            "content-disposition",
            `${req.query.download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
          );
        if (isActiveContent(mime)) {
          reply.header("content-security-policy", UNTRUSTED_FILE_CSP);
        }
        return reply.send(createReadStream(abs));
      },
    );

    // ---- content for the assistant (Markdown conversions, page images) ----

    /** Files at these paths (folders expanded). */
    const filesUnder = async (refs: { tree(): Promise<ReferenceNode> }, paths: string[]) => {
      const wanted = paths.map(validatePath);
      const out: string[] = [];
      const walk = (n: ReferenceNode, inside: boolean) => {
        const hit = inside || wanted.includes(n.path);
        if (n.kind === "file" && hit) out.push(n.path);
        n.children?.forEach((c) => walk(c, hit));
      };
      walk(await refs.tree(), wanted.includes(""));
      return out;
    };

    /** Converts files (or the files of folders) now; `force` converts again even when up to date. */
    app.post("/references/mcp/convert", { schema: { body: ConvertReferencesBodySchema } }, async (req) => {
      const files = await filesUnder(req.nb.refs, req.body.paths);
      const results = [];
      for (const path of files.filter((f) => mcpKindOf(f) === "convertible")) results.push({ path, ...(await req.nb.refs.mcp.convert(path, { force: req.body.force })) });
      return { results };
    });

    /** Stored content of a file: MCP status, manifest and Markdown (404 when not converted). */
    app.get("/references/mcp", { schema: { querystring: ReferencePathQuerySchema } }, async (req) => {
      const path = validatePath(req.query.path);
      await req.nb.refs.file(path);
      const content = await req.nb.refs.mcp.content(path);
      if (!content) throw notFound(`Converted content of ${path}`);
      return { info: await req.nb.refs.mcp.info(path), ...content };
    });

    app.delete("/references/mcp", { schema: { querystring: ReferencePathQuerySchema } }, async (req, reply) => {
      await req.nb.refs.mcp.remove([validatePath(req.query.path)]);
      req.nb.refs.onChange();
      reply.code(204);
    });

    app.get(
      "/references/mcp/page",
      { schema: { querystring: z.object({ path: z.string().min(1), n: z.coerce.number().int().positive() }) } },
      async (req, reply) => {
        const file = await req.nb.refs.mcp.pageImage(validatePath(req.query.path), req.query.n);
        if (!file) throw notFound(`Image of page ${req.query.n}`);
        return reply.type("image/webp").header("cache-control", "no-cache").send(createReadStream(file));
      },
    );

    app.get(
      "/references/mcp/figure",
      { schema: { querystring: z.object({ path: z.string().min(1), id: z.string().regex(/^p\d+-\d+$/) }) } },
      async (req, reply) => {
        const file = await req.nb.refs.mcp.figureImage(validatePath(req.query.path), req.query.id);
        if (!file) throw notFound(`Figure ${req.query.id}`);
        return reply.type("image/webp").header("cache-control", "no-cache").send(createReadStream(file));
      },
    );

    app.post("/references/mcp/pages", { schema: { body: RenderPagesBodySchema } }, async (req) => ({
      manifest: await req.nb.refs.mcp.renderPages(validatePath(req.body.path), req.body.pages),
    }));

    app.put("/references/mcp/transcription", { schema: { body: TranscriptionBodySchema } }, async (req) => ({
      manifest: await req.nb.refs.mcp.saveTranscription(validatePath(req.body.path), req.body.page, req.body.markdown, req.body.by ?? "the assistant"),
    }));

    /** An image reference scaled for the assistant (longest side ≤ 1568 px, WebP). */
    app.get("/references/mcp/image", { schema: { querystring: ReferencePathQuerySchema } }, async (req, reply) => {
      const { abs } = await req.nb.refs.file(req.query.path);
      if (mcpKindOf(abs) !== "image") throw badRequest("Not an image");
      const { loadImage, createCanvas } = await import("@napi-rs/canvas");
      const img = await loadImage(abs);
      const scale = Math.min(1, 1568 / Math.max(img.width, img.height));
      const canvas = createCanvas(Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      return reply.type("image/webp").send(await canvas.encode("webp", 85));
    });

    app.post("/references/upload", { schema: { querystring: UploadReferencesQuerySchema } }, async (req, reply) => {
      const saved: string[] = [];
      for await (const part of req.files({ limits: { fileSize: MAX_UPLOAD, files: 100 } })) {
        const data = await part.toBuffer();
        if (part.file.truncated) throw badRequest(`${part.filename} exceeds ${MAX_UPLOAD / 1024 / 1024} MB`);
        saved.push(await req.nb.refs.save(req.query.dir, part.filename, data));
      }
      if (!saved.length) throw badRequest("No files uploaded");
      reply.code(201);
      return { paths: saved };
    });

    app.post("/references/folders", { schema: { body: CreateReferenceFolderBodySchema } }, async (req, reply) => {
      reply.code(201);
      return { path: await req.nb.refs.createFolder(req.body.path) };
    });

    // Renames move associations and Markdown links along with the file or folder.
    app.patch("/references/rename", { schema: { body: RenameReferenceBodySchema } }, async (req) => {
      const from = validatePath(req.body.path);
      const path = await req.nb.refs.rename(req.body.path, req.body.newName);
      if (path !== from) await req.nb.store.renameReferencePath(from, path);
      return { path };
    });

    // Moves carry associations and Markdown links along, like renames.
    app.post("/references/move", { schema: { body: MoveReferencesBodySchema } }, async (req) => {
      const moved = await req.nb.refs.move(req.body.paths, req.body.dir);
      for (const { from, to } of moved) await req.nb.store.renameReferencePath(from, to);
      return { moved };
    });

    /** Where a file (or anything inside a folder) is associated or linked. */
    app.get("/references/usages", { schema: { querystring: ReferencePathQuerySchema } }, async (req) =>
      req.nb.store.referenceUsages(validatePath(req.query.path)),
    );

    // ---- associations with whole sections / sub-blocks ----
    const checkPaths = async (refs: { file(p: string): Promise<unknown> }, paths: string[]) => {
      const normalized = paths.map(validatePath);
      const missing: string[] = [];
      for (const p of normalized) await refs.file(p).catch(() => missing.push(p));
      if (missing.length) throw badRequest(`Unknown reference file(s): ${missing.join(", ")}`);
      return normalized;
    };
    app.put("/blocks/:id/references", { schema: { params: BlockIdParamsSchema, body: AttachReferencesBodySchema } }, async (req) => ({
      paths: await req.nb.store.setReferences(req.params.id, null, await checkPaths(req.nb.refs, req.body.paths)),
    }));
    app.put(
      "/blocks/:blockId/subblocks/:subBlockId/references",
      { schema: { params: SubBlockParamsSchema, body: AttachReferencesBodySchema } },
      async (req) => ({
        paths: await req.nb.store.setReferences(req.params.blockId, req.params.subBlockId, await checkPaths(req.nb.refs, req.body.paths)),
      }),
    );

    /**
     * Streams a ZIP of the selected files/folders (entries relative to `base`), reading one file at a time
     * so large selections never sit in memory.
     */
    app.post("/references/zip", { schema: { body: ZipReferencesBodySchema } }, async (req, reply) => {
      const entries = await req.nb.refs.zipEntries(req.body.paths, req.body.base);
      const out = new PassThrough();
      const zip = new Zip((err, chunk, final) => {
        if (err) return void out.destroy(err);
        out.write(chunk);
        if (final) out.end();
      });
      (async (req) => {
        for (const { name, abs } of entries) {
          const ext = extname(name).slice(1).toLowerCase();
          const entry = !abs || STORED.has(ext) ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
          zip.add(entry);
          if (abs) for await (const chunk of createReadStream(abs)) entry.push(chunk as Uint8Array);
          entry.push(new Uint8Array(0), true);
        }
        zip.end();
      })().catch((e) => out.destroy(e));

      const base = req.body.base ? basename(req.body.base) : "references";
      const single = req.body.paths.length === 1 ? basename(req.body.paths[0]) : null;
      const zipName = `${single ?? base}.zip`;
      reply
        .type("application/zip")
        .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);
      return reply.send(out);
    });

    // Deleting drops the associations of the deleted files; links in text stay (shown as missing).
    app.post("/references/delete", { schema: { body: ReferencePathsBodySchema } }, async (req) => {
      const deleted = await req.nb.refs.deleteMany(req.body.paths);
      await req.nb.store.removeReferencePaths(deleted);
      return { deleted };
    });

    app.delete("/references", { schema: { querystring: ReferencePathQuerySchema } }, async (req, reply) => {
      await req.nb.refs.delete(req.query.path);
      await req.nb.store.removeReferencePaths([validatePath(req.query.path)]);
      reply.code(204);
    });
  };
