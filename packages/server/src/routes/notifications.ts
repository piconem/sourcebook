import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { CreateNotificationBodySchema, NotificationParamsSchema, ReloadRequestBodySchema } from "@sourcebook/shared";
import type { UserStore } from "../store/UserStore.js";

/** Change notifications from external applications / assistants, and reload requests for open editors. */
export const notificationRoutes =
  (users: UserStore): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/notifications", async (req) => ({ notifications: await req.nb.notifications.list() }));

    app.post("/notifications", { schema: { body: CreateNotificationBodySchema } }, async (req, reply) => {
      const author = req.body.author ?? (await users.get());
      const created = await req.nb.notifications.add(author, req.body.summary, req.body.targets);
      if (req.body.requestReload) await req.nb.notifications.requestReload(author, undefined, [created.id]);
      reply.code(201);
      return created;
    });

    app.post("/notifications/read-all", async (req) => ({ notifications: await req.nb.notifications.markRead() }));

    app.post("/notifications/:notificationId/read", { schema: { params: NotificationParamsSchema } }, async (req) => ({
      notifications: await req.nb.notifications.markRead(req.params.notificationId),
    }));

    app.delete("/notifications", async (req, reply) => {
      await req.nb.notifications.clear();
      reply.code(204);
    });

    app.post("/reload-request", { schema: { body: ReloadRequestBodySchema.nullish() } }, async (req) => {
      const author = req.body?.author ?? (await users.get());
      return req.nb.notifications.requestReload(author, req.body?.message, req.body?.notificationIds);
    });
  };
