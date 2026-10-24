import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  BlockIdParamsSchema,
  CreateSubBlockBodySchema,
  DeleteSubBlockQuerySchema,
  EditSubBlockBodySchema,
  ReorderSubBlocksBodySchema,
  SubBlockParamsSchema,
  UpdateSubBlockBodySchema,
} from "@sourcebook/shared";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

/** Sub-blocks of a section and of its sub-sections. */
export function subBlocksUnder(req: FastifyRequest, blockId: string): string[] {
  const blocks = req.nb.store.getProject().blocks;
  const ids = new Set([blockId]);
  for (const b of blocks) if (b.parentId && ids.has(b.parentId)) ids.add(b.id); // depth-first order
  return blocks.filter((b) => ids.has(b.id)).flatMap((b) => b.subBlocks.map((s) => s.id));
}

export const subBlockRoutes =
  (): FastifyPluginAsyncZod =>
  async (app) => {
    /** Changing a sub-block locked by someone else: 423. */
    const free = (req: FastifyRequest, ...subBlockIds: string[]) => req.nb.locks.assertFree(subBlockIds, req.principal.author);

    // ---- locks: take a sub-block while working on it ----
    app.get("/locks", async (req) => ({ locks: await req.nb.locks.list() }));

    app.post("/blocks/:blockId/subblocks/:subBlockId/lock", { schema: { params: SubBlockParamsSchema } }, async (req) =>
      req.nb.locks.acquire(req.params.blockId, req.params.subBlockId, req.principal.author),
    );

    app.delete(
      "/blocks/:blockId/subblocks/:subBlockId/lock",
      { schema: { params: SubBlockParamsSchema, querystring: z.object({ force: z.enum(["1", "true", "0", "false"]).optional() }) } },
      async (req, reply) => {
        await req.nb.locks.release(req.params.subBlockId, req.principal, req.query.force === "1" || req.query.force === "true");
        reply.code(204);
      },
    );

    app.post(
      "/blocks/:id/subblocks",
      { schema: { params: BlockIdParamsSchema, body: CreateSubBlockBodySchema } },
      async (req, reply) => {
        reply.code(201);
        return req.nb.store.addSubBlock(req.params.id, req.body);
      },
    );

    app.patch(
      "/blocks/:blockId/subblocks/reorder",
      { schema: { params: z.object({ blockId: z.string() }), body: ReorderSubBlocksBodySchema } },
      async (req) => req.nb.store.reorderSubBlocks(req.params.blockId, req.body.order),
    );

    app.patch(
      "/blocks/:blockId/subblocks/:subBlockId",
      { schema: { params: SubBlockParamsSchema, body: UpdateSubBlockBodySchema } },
      async (req) => {
        await free(req, req.params.subBlockId);
        return req.nb.store.updateSubBlock(req.params.blockId, req.params.subBlockId, req.body);
      },
    );

    app.post(
      "/blocks/:blockId/subblocks/:subBlockId/edit",
      { schema: { params: SubBlockParamsSchema, body: EditSubBlockBodySchema } },
      async (req) => {
        await free(req, req.params.subBlockId);
        return req.nb.store.editSubBlock(req.params.blockId, req.params.subBlockId, req.body.edits, req.body.expectedRev);
      },
    );

    app.delete(
      "/blocks/:blockId/subblocks/:subBlockId",
      { schema: { params: SubBlockParamsSchema, querystring: DeleteSubBlockQuerySchema } },
      async (req) => {
        await free(req, req.params.subBlockId);
        const result = await req.nb.store.deleteSubBlock(req.params.blockId, req.params.subBlockId, req.query.deleteAssets);
        await req.nb.locks.drop([req.params.subBlockId]);
        return result;
      },
    );
  };
