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
import { z } from "zod";

export const subBlockRoutes =
  (): FastifyPluginAsyncZod =>
  async (app) => {
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
      async (req) => req.nb.store.updateSubBlock(req.params.blockId, req.params.subBlockId, req.body),
    );

    app.post(
      "/blocks/:blockId/subblocks/:subBlockId/edit",
      { schema: { params: SubBlockParamsSchema, body: EditSubBlockBodySchema } },
      async (req) => req.nb.store.editSubBlock(req.params.blockId, req.params.subBlockId, req.body.edits, req.body.expectedRev),
    );

    app.delete(
      "/blocks/:blockId/subblocks/:subBlockId",
      { schema: { params: SubBlockParamsSchema, querystring: DeleteSubBlockQuerySchema } },
      async (req) => req.nb.store.deleteSubBlock(req.params.blockId, req.params.subBlockId, req.query.deleteAssets),
    );
  };
