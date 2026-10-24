import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  CommentParamsSchema,
  CreateCommentBodySchema,
  CreateThreadBodySchema,
  ProjectCommentsQuerySchema,
  ResolveCommentBodySchema,
  UpdateCommentBodySchema,
  ReplyParamsSchema,
  SubBlockParamsSchema,
} from "@sourcebook/shared";
import type { UserStore } from "../store/UserStore.js";
import { checkAuthor, listParticipants } from "../participants.js";

const base = "/blocks/:blockId/subblocks/:subBlockId/comments";

export const commentRoutes =
  (users: UserStore): FastifyPluginAsyncZod =>
  async (app) => {

    /** Who signed comments and notifications in the project, plus the local user. */
    app.get("/participants", async (req) => ({ participants: await listParticipants(req.nb, await users.get()) }));

    /** All threads of the project (document order); ?status=open|resolved|all. */
    app.get("/comments", { schema: { querystring: ProjectCommentsQuerySchema } }, async (req) => ({
      threads: await req.nb.store.listProjectComments(req.query.status),
    }));

    app.get(base, { schema: { params: SubBlockParamsSchema } }, async (req) => ({
      comments: await req.nb.store.listComments(req.params.blockId, req.params.subBlockId),
    }));

    app.post(base, { schema: { params: SubBlockParamsSchema, body: CreateThreadBodySchema } }, async (req, reply) => {
      if (req.body.author) await checkAuthor(req.nb, await users.get(), req.body.author);
      const author = req.body.author ?? (await users.get());
      reply.code(201);
      return req.nb.store.addComment(req.params.blockId, req.params.subBlockId, author, req.body.text, req.body.anchor);
    });

    app.patch(
      `${base}/:commentId`,
      { schema: { params: CommentParamsSchema, body: UpdateCommentBodySchema } },
      async (req) => req.nb.store.setCommentAnchor(req.params.blockId, req.params.subBlockId, req.params.commentId, req.body.anchor),
    );

    app.delete(`${base}/:commentId`, { schema: { params: CommentParamsSchema } }, async (req, reply) => {
      await req.nb.store.deleteComment(req.params.blockId, req.params.subBlockId, req.params.commentId);
      reply.code(204);
    });

    app.post(
      `${base}/:commentId/resolve`,
      { schema: { params: CommentParamsSchema, body: ResolveCommentBodySchema.nullish() } },
      async (req) => {
        if (req.body?.author) await checkAuthor(req.nb, await users.get(), req.body.author);
        const author = req.body?.author ?? (await users.get());
        return req.nb.store.setCommentResolution(req.params.blockId, req.params.subBlockId, req.params.commentId, author);
      },
    );

    app.post(`${base}/:commentId/reopen`, { schema: { params: CommentParamsSchema } }, async (req) =>
      req.nb.store.setCommentResolution(req.params.blockId, req.params.subBlockId, req.params.commentId, null),
    );

    app.post(
      `${base}/:commentId/replies`,
      { schema: { params: CommentParamsSchema, body: CreateCommentBodySchema } },
      async (req, reply) => {
        if (req.body.author) await checkAuthor(req.nb, await users.get(), req.body.author);
        const author = req.body.author ?? (await users.get());
        reply.code(201);
        return req.nb.store.addReply(req.params.blockId, req.params.subBlockId, req.params.commentId, author, req.body.text);
      },
    );

    app.delete(`${base}/:commentId/replies/:replyId`, { schema: { params: ReplyParamsSchema } }, async (req, reply) => {
      await req.nb.store.deleteComment(req.params.blockId, req.params.subBlockId, req.params.commentId, req.params.replyId);
      reply.code(204);
    });
  };
