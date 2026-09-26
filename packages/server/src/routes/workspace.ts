import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { createReadStream } from "node:fs";
import { extname } from "node:path";
import { PassThrough } from "node:stream";
import { HttpError, badRequest } from "../errors.js";
import { ARCHIVE_FORMAT, ARCHIVE_VERSION, LIMITS, MANIFEST_FILE } from "../store/templateArchive.js";
import {
  CreateProjectBodySchema,
  ProjectIdSchema,
  UpdateProjectBodySchema,
  UserProfileSchema,
  type NotebookKind,
} from "@sourcebook/shared";
import { z } from "zod";
import type { UserStore } from "../store/UserStore.js";
import type { WorkspaceStore } from "../store/WorkspaceStore.js";

/** Workspace-level API: user profile, sub-block types, and the project/template collections. */
export const workspaceRoutes =
  (workspace: WorkspaceStore, users: UserStore, types: () => { type: string; label: string; sourceExt: string }[]): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/api/user", async () => users.get());
    app.put("/api/user", { schema: { body: UserProfileSchema } }, async (req) => users.set(req.body));
    app.get("/api/types", async () => types());

    // ---- template archives ----
    const STORED = new Set(["png", "jpg", "jpeg", "gif", "webp", "pdf", "zip", "mp4", "mp3"]);

    /** Template as a ZIP: manifest + the template folder (comments excluded), streamed. */
    app.get("/api/templates/:projectId/archive.zip", { schema: { params: z.object({ projectId: ProjectIdSchema }) } }, async (req, reply) => {
      const id = req.params.projectId;
      const summary = await workspace.summary("templates", id);
      const files = await workspace.archiveFiles("templates", id);
      const manifest = {
        format: ARCHIVE_FORMAT,
        version: ARCHIVE_VERSION,
        exportedAt: new Date().toISOString(),
        template: { name: summary.name, description: summary.description },
      };
      const out = new PassThrough();
      const zip = new Zip((err, chunk, final) => {
        if (err) return void out.destroy(err);
        out.write(chunk);
        if (final) out.end();
      });
      (async () => {
        const m = new ZipDeflate(MANIFEST_FILE, { level: 6 });
        zip.add(m);
        m.push(strToU8(JSON.stringify(manifest, null, 2) + "\n"), true);
        for (const f of files) {
          const entry = STORED.has(extname(f.name).slice(1).toLowerCase()) ? new ZipPassThrough(f.name) : new ZipDeflate(f.name, { level: 6 });
          zip.add(entry);
          for await (const chunk of createReadStream(f.abs)) entry.push(chunk as Uint8Array);
          entry.push(new Uint8Array(0), true);
        }
        zip.end();
      })().catch((e) => out.destroy(e));
      reply
        .type("application/zip")
        .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${id}.sourcebook-template.zip`)}`);
      return reply.send(out);
    });

    /**
     * Imports a template ZIP (multipart field "file"). The archive is fully validated first; on problems
     * the answer is 400 with every error found. `?dryRun=1` only validates and returns a preview.
     */
    app.post(
      "/api/templates/import",
      { schema: { querystring: z.object({ dryRun: z.enum(["1", "0", "true", "false"]).optional(), name: z.string().max(120).optional() }) } },
      async (req, reply) => {
        const file = await req.file({ limits: { fileSize: LIMITS.compressedBytes, files: 1 } });
        if (!file) throw badRequest("Missing file");
        const data = await file.toBuffer();
        if (file.file.truncated) throw badRequest(`The archive is larger than ${LIMITS.compressedBytes / 1024 / 1024} MB.`);
        const fallbackName = file.filename.replace(/(\.sourcebook-template)?\.zip$/i, "").replace(/[-_]+/g, " ").trim() || undefined;
        const result = workspace.validateTemplateArchive(new Uint8Array(data), fallbackName);
        if (!result.ok) throw new HttpError(400, "Invalid template archive", { errors: result.errors, warnings: result.warnings });
        const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
        if (dryRun) return { valid: true, ...result.preview };
        reply.code(201);
        return { ...(await workspace.importTemplate(result, req.query.name)), warnings: result.preview.warnings };
      },
    );

    for (const kind of ["projects", "templates"] as NotebookKind[]) {
      const params = z.object({ projectId: ProjectIdSchema });
      app.get(`/api/${kind}`, async () => workspace.list(kind));
      app.post(`/api/${kind}`, { schema: { body: CreateProjectBodySchema } }, async (req, reply) => {
        reply.code(201);
        return workspace.create(kind, req.body);
      });
      app.get(`/api/${kind}/:projectId`, { schema: { params } }, async (req) => workspace.summary(kind, req.params.projectId));
      app.patch(`/api/${kind}/:projectId`, { schema: { params, body: UpdateProjectBodySchema } }, async (req) =>
        workspace.update(kind, req.params.projectId, req.body),
      );
      app.delete(`/api/${kind}/:projectId`, { schema: { params } }, async (req, reply) => {
        await workspace.delete(kind, req.params.projectId);
        reply.code(204);
      });
    }
  };
