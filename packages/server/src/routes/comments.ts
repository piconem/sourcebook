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
import type { FastifyRequest } from "fastify";
import { requestAuthor } from "../auth.js";
import { HttpError } from "../errors.js";
import type { AccountStore } from "../store/AccountStore.js";
import { checkAuthor, listParticipants } from "../participants.js";

const base = "/blocks/:blockId/subblocks/:subBlockId/comments";

/** Readers of a project may comment: these routes need read access only. */
const READ = { access: "read" as const };

export const commentRoutes =
  (authEnabled: boolean, accounts: AccountStore): FastifyPluginAsyncZod =>
  async (app) => {
    /** Single-user mode honours an explicit author (checked against the participants); with accounts, the principal signs. */
    const authorOf = async (req: FastifyRequest & { nb: Parameters<typeof checkAuthor>[0] }, explicit: Parameters<typeof requestAuthor>[1]) => {
      if (!authEnabled && explicit) await checkAuthor(req.nb, req.principal.user, explicit);
      return requestAuthor(req, explicit, authEnabled);
    };

    /** Who signed comments and notifications in the project, plus the local user. */
    app.get("/participants", async (req) => {
      if (!authEnabled) return { participants: await listParticipants(req.nb, { local: req.principal.user }) };
      const users = accounts.listUsers().filter((u) => !u.disabled && accounts.accessLevel(u, req.nb.kind, req.nb.id));
      const agents = accounts.listAgents().filter((a) => users.some((u) => u.username === a.owner));
      return { participants: await listParticipants(req.nb, { users, agents }) };
    });

    /** All threads of the project (document order); ?status=open|resolved|all. */
    app.get("/comments", { schema: { querystring: ProjectCommentsQuerySchema } }, async (req) => ({
      threads: await req.nb.store.listProjectComments(req.query.status),
    }));

    app.get(base, { schema: { params: SubBlockParamsSchema } }, async (req) => ({
      comments: await req.nb.store.listComments(req.params.blockId, req.params.subBlockId),
    }));

    app.post(base, { config: READ, schema: { params: SubBlockParamsSchema, body: CreateThreadBodySchema } }, async (req, reply) => {
      const author = await authorOf(req, req.body.author);
      reply.code(201);
      return req.nb.store.addComment(req.params.blockId, req.params.subBlockId, author, req.body.text, req.body.anchor);
    });

    app.patch(
      `${base}/:commentId`,
      { config: READ, schema: { params: CommentParamsSchema, body: UpdateCommentBodySchema } },
      async (req) => req.nb.store.setCommentAnchor(req.params.blockId, req.params.subBlockId, req.params.commentId, req.body.anchor),
    );

    /** Writers delete any comment; readers only their own. */
    const assertCanDelete = async (req: FastifyRequest & { nb: { store: { listComments(b: string, s: string): Promise<{ id: string; author: { username: string }; replies: { id: string; author: { username: string } }[] }[]> } } }, blockId: string, subBlockId: string, commentId: string, replyId?: string) => {
      if (req.access === "write") return;
      const c = (await req.nb.store.listComments(blockId, subBlockId)).find((x) => x.id === commentId);
      const target = replyId ? c?.replies.find((r) => r.id === replyId) : c;
      if (target && target.author.username !== req.principal.author.username) throw new HttpError(403, "With read access you can only delete your own comments");
    };

    app.delete(`${base}/:commentId`, { config: READ, schema: { params: CommentParamsSchema } }, async (req, reply) => {
      await assertCanDelete(req, req.params.blockId, req.params.subBlockId, req.params.commentId);
      await req.nb.store.deleteComment(req.params.blockId, req.params.subBlockId, req.params.commentId);
      reply.code(204);
    });

    app.post(
      `${base}/:commentId/resolve`,
      { config: READ, schema: { params: CommentParamsSchema, body: ResolveCommentBodySchema.nullish() } },
      async (req) => {
        const author = await authorOf(req, req.body?.author);
        return req.nb.store.setCommentResolution(req.params.blockId, req.params.subBlockId, req.params.commentId, author);
      },
    );

    app.post(`${base}/:commentId/reopen`, { config: READ, schema: { params: CommentParamsSchema } }, async (req) =>
      req.nb.store.setCommentResolution(req.params.blockId, req.params.subBlockId, req.params.commentId, null),
    );

    app.post(
      `${base}/:commentId/replies`,
      { config: READ, schema: { params: CommentParamsSchema, body: CreateCommentBodySchema } },
      async (req, reply) => {
        const author = await authorOf(req, req.body.author);
        reply.code(201);
        return req.nb.store.addReply(req.params.blockId, req.params.subBlockId, req.params.commentId, author, req.body.text);
      },
    );

    app.delete(`${base}/:commentId/replies/:replyId`, { config: READ, schema: { params: ReplyParamsSchema } }, async (req, reply) => {
      await assertCanDelete(req, req.params.blockId, req.params.subBlockId, req.params.commentId, req.params.replyId);
      await req.nb.store.deleteComment(req.params.blockId, req.params.subBlockId, req.params.commentId, req.params.replyId);
      reply.code(204);
    });
  };
