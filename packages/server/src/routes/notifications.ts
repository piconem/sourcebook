import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { CreateNotificationBodySchema, NotificationParamsSchema, ReloadRequestBodySchema } from "@sourcebook/shared";
import { requestAuthor } from "../auth.js";
import { checkAuthor } from "../participants.js";

/** Change notifications from external applications / assistants, and reload requests for open editors. */
export const notificationRoutes =
  (authEnabled: boolean): FastifyPluginAsyncZod =>
  async (app) => {
    const reader = (req: { principal: { author: { username: string } } }) => req.principal.author.username;

    app.get("/notifications", async (req) => ({ notifications: await req.nb.notifications.list(reader(req)) }));

    app.post("/notifications", { schema: { body: CreateNotificationBodySchema } }, async (req, reply) => {
      if (!authEnabled && req.body.author) await checkAuthor(req.nb, req.principal.user, req.body.author);
      const author = requestAuthor(req, req.body.author, authEnabled);
      const created = await req.nb.notifications.add(author, req.body.summary, req.body.targets);
      if (req.body.requestReload) await req.nb.notifications.requestReload(author, undefined, [created.id]);
      reply.code(201);
      return created;
    });

    // Read state is personal: readers may mark notifications read.
    app.post("/notifications/read-all", { config: { access: "read" } }, async (req) => ({ notifications: await req.nb.notifications.markRead(reader(req)) }));

    app.post("/notifications/:notificationId/read", { config: { access: "read" }, schema: { params: NotificationParamsSchema } }, async (req) => ({
      notifications: await req.nb.notifications.markRead(reader(req), req.params.notificationId),
    }));

    app.delete("/notifications", async (req, reply) => {
      await req.nb.notifications.clear();
      reply.code(204);
    });

    app.post("/reload-request", { schema: { body: ReloadRequestBodySchema.nullish() } }, async (req) => {
      if (!authEnabled && req.body?.author) await checkAuthor(req.nb, req.principal.user, req.body.author);
      const author = requestAuthor(req, req.body?.author, authEnabled);
      return req.nb.notifications.requestReload(author, req.body?.message, req.body?.notificationIds);
    });
  };
