import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { UploadAssetResponse } from "@sourcebook/shared";
import { extname } from "node:path";
import { z } from "zod";
import { badRequest } from "../errors.js";

const ALLOWED = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"]);

export const assetRoutes =
  (): FastifyPluginAsyncZod =>
  async (app) => {
    app.delete(
      "/blocks/:id/assets/:name",
      { schema: { params: z.object({ id: z.string().min(1), name: z.string().min(1) }) } },
      async (req, reply) => {
        await req.nb.store.deleteAsset(req.params.id, req.params.name);
        reply.code(204);
      },
    );

    /** multipart/form-data with a single `file` field; target block given as ?blockId=. */
    app.post(
      "/assets",
      { schema: { querystring: z.object({ blockId: z.string().min(1) }) } },
      async (req, reply): Promise<UploadAssetResponse> => {
        const file = await req.file();
        if (!file) throw badRequest("Missing file");
        const ext = extname(file.filename).slice(1).toLowerCase();
        if (!ALLOWED.has(ext)) throw badRequest(`Unsupported file type ".${ext}"`);
        const path = await req.nb.store.saveAsset(req.query.blockId, ext, await file.toBuffer());
        reply.code(201);
        return { path, url: `${req.server.basePath}/api/${req.nb.kind}/${req.nb.id}/blocks/${req.query.blockId}/files/${path}` };
      },
    );
  };
