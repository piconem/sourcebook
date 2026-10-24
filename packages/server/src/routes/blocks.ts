import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  BlockFilesParamsSchema,
  BlockIdParamsSchema,
  CreateBlockBodySchema,
  ReorderBlocksBodySchema,
  UpdateBlockBodySchema,
} from "@sourcebook/shared";
import { normalize } from "node:path";
import { badRequest } from "../errors.js";
import { subBlocksUnder } from "./subblocks.js";

export const blockRoutes =
  (): FastifyPluginAsyncZod =>
  async (app) => {
    app.post("/blocks", { schema: { body: CreateBlockBodySchema } }, async (req, reply) => {
      reply.code(201);
      return req.nb.store.createBlock(req.body);
    });

    // Static segment wins over "/blocks/:id" in Fastify's router.
    app.patch("/blocks/reorder", { schema: { body: ReorderBlocksBodySchema } }, async (req) =>
      req.nb.store.reorderBlocks(req.body),
    );

    app.get("/blocks/:id", { schema: { params: BlockIdParamsSchema } }, async (req) =>
      req.nb.store.getBlock(req.params.id),
    );

    app.patch(
      "/blocks/:id",
      { schema: { params: BlockIdParamsSchema, body: UpdateBlockBodySchema } },
      async (req) => req.nb.store.updateBlock(req.params.id, req.body),
    );

    app.get("/blocks/:id/deletion-impact", { schema: { params: BlockIdParamsSchema } }, async (req) =>
      req.nb.store.blockDeletionImpact(req.params.id),
    );

    app.delete("/blocks/:id", { schema: { params: BlockIdParamsSchema } }, async (req, reply) => {
      // A section holding sub-blocks locked by someone else cannot be deleted.
      const subBlocks = subBlocksUnder(req, req.params.id);
      await req.nb.locks.assertFree(subBlocks, req.principal.author);
      await req.nb.store.deleteBlock(req.params.id);
      await req.nb.locks.drop(subBlocks);
      reply.code(204);
    });

    // Serves files inside a block folder by stable block id (folder names change on reorder).
    app.get("/blocks/:id/files/*", { schema: { params: BlockFilesParamsSchema } }, async (req, reply) => {
      const rel = normalize(req.params["*"]);
      if (rel.startsWith("..") || rel.startsWith("/")) throw badRequest("Invalid path");
      reply.header("cache-control", "no-cache");
      return reply.sendFile(rel, req.nb.store.blockDir(req.params.id));
    });
  };
