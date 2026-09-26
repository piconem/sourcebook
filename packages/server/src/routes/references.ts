import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  CreateReferenceFolderBodySchema,
  ReferencePathsBodySchema,
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
import { badRequest } from "../errors.js";

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
          reply.header(
            "content-security-policy",
            "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:",
          );
        }
        return reply.send(createReadStream(abs));
      },
    );

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

    app.patch("/references/rename", { schema: { body: RenameReferenceBodySchema } }, async (req) => ({
      path: await req.nb.refs.rename(req.body.path, req.body.newName),
    }));

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

    app.post("/references/delete", { schema: { body: ReferencePathsBodySchema } }, async (req) => ({
      deleted: await req.nb.refs.deleteMany(req.body.paths),
    }));

    app.delete("/references", { schema: { querystring: ReferencePathQuerySchema } }, async (req, reply) => {
      await req.nb.refs.delete(req.query.path);
      reply.code(204);
    });
  };
