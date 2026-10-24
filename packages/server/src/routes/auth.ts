import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  ChangePasswordBodySchema,
  CreateAgentBodySchema,
  CreateAccessTokenBodySchema,
  CreateUserBodySchema,
  LoginBodySchema,
  NotebookKindSchema,
  ProjectIdSchema,
  SetAccessBodySchema,
  UpdateUserBodySchema,
  type AgentFootprint,
  type Me,
  type ProjectAccess,
} from "@sourcebook/shared";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError, badRequest, notFound } from "../errors.js";
import { LoginThrottle, requireOwner, sessionToken, setSessionCookie, type AuthOptions } from "../auth.js";
import { authorOf } from "../store/AccountStore.js";
import { KINDS, type WorkspaceStore } from "../store/WorkspaceStore.js";
import { AvatarStore } from "../store/AvatarStore.js";
import { createReadStream, existsSync } from "node:fs";

const me = (req: FastifyRequest): Me => ({
  user: req.principal.user,
  ...(req.principal.agent ? { agent: req.principal.agent } : {}),
  author: req.principal.author,
  via: req.principal.via,
});

/** Account matters (password, profile, access tokens) need the person, signed in. */
const signedIn = (req: FastifyRequest) => {
  if (req.principal.via !== "session") throw new HttpError(403, "Sign in to Sourcebook to do this");
};

/** Sign-in, own account, users and their access rights (owner), agents. */
export const authRoutes =
  (opts: AuthOptions, workspace: WorkspaceStore): FastifyPluginAsyncZod =>
  async (app) => {
    const { accounts } = opts;
    const avatars = new AvatarStore(accounts.dir);
    const throttle = new LoginThrottle();

    // ---- session ----
    app.post("/api/auth/login", { schema: { body: LoginBodySchema } }, async (req, reply) => {
      const key = `${req.ip}|${req.body.username.toLowerCase()}`;
      throttle.check(key);
      const user = await accounts.authenticate(req.body.username, req.body.password);
      if (!user) {
        throttle.fail(key);
        throw new HttpError(401, "Wrong username or password");
      }
      throttle.succeed(key);
      const { token, expiresAt } = await accounts.createSession(user.username);
      setSessionCookie(reply, opts, token, expiresAt);
      return { user, author: authorOf(user) } satisfies Me;
    });

    app.post("/api/auth/logout", async (req, reply) => {
      const token = sessionToken(req, opts);
      if (token) await accounts.deleteSession(token);
      setSessionCookie(reply, opts, null);
      reply.code(204);
    });

    app.get("/api/auth/me", async (req) => {
      if (!req.principal) throw new HttpError(401, "Not signed in");
      return me(req);
    });

    app.post("/api/auth/password", { schema: { body: ChangePasswordBodySchema } }, async (req) => {
      signedIn(req);
      await accounts.changePassword(req.principal.user.username, req.body.currentPassword, req.body.newPassword);
      const user = accounts.getUser(req.principal.user.username)!;
      return { user, author: authorOf(user) } satisfies Me;
    });

    app.patch("/api/auth/profile", { schema: { body: z.object({ name: z.string().trim().min(1).max(100) }) } }, async (req) => {
      signedIn(req);
      const user = await accounts.updateUser(req.principal.user.username, { name: req.body.name });
      return { user, author: authorOf(user) } satisfies Me;
    });

    // ---- users (everyone sees the list, to show names; only the owner manages it) ----
    const usernameParams = z.object({ username: z.string().min(1).max(39) });
    app.get("/api/users", async () => ({ users: accounts.listUsers() }));

    app.post("/api/users", { schema: { body: CreateUserBodySchema } }, async (req, reply) => {
      requireOwner(req);
      reply.code(201);
      return accounts.createUser(req.body);
    });

    app.patch("/api/users/:username", { schema: { params: usernameParams, body: UpdateUserBodySchema } }, async (req) => {
      requireOwner(req);
      if (req.params.username === req.principal.user.username && (req.body.disabled || (req.body.role && req.body.role !== "owner"))) {
        throw badRequest("You cannot disable yourself or give up your own owner role");
      }
      return accounts.updateUser(req.params.username, req.body);
    });

    app.delete("/api/users/:username", { schema: { params: usernameParams } }, async (req, reply) => {
      requireOwner(req);
      if (req.params.username === req.principal.user.username) throw badRequest("You cannot delete yourself");
      await accounts.deleteUser(req.params.username);
      reply.code(204);
    });

    // ---- access rights to projects and templates (owner) ----
    app.get("/api/access", async (req) => {
      requireOwner(req);
      const out: ProjectAccess[] = [];
      for (const kind of KINDS) {
        for (const p of await workspace.list(kind)) out.push({ kind, id: p.id, name: p.name, access: accounts.accessOf(kind, p.id) });
      }
      return { projects: out };
    });

    app.put(
      "/api/access/:kind/:projectId",
      { schema: { params: z.object({ kind: NotebookKindSchema, projectId: ProjectIdSchema }), body: SetAccessBodySchema } },
      async (req) => {
        requireOwner(req);
        await workspace.summary(req.params.kind, req.params.projectId); // 404 if missing
        return { access: await accounts.setAccess(req.params.kind, req.params.projectId, req.body.access) };
      },
    );

    /** Every locked sub-block of every project and template (owner: to release forgotten locks). */
    app.get("/api/locks", async (req) => {
      requireOwner(req);
      const locks = [];
      for (const kind of KINDS) {
        for (const p of await workspace.list(kind)) {
          for (const l of await (await workspace.open(kind, p.id)).locks.list()) locks.push({ ...l, kind, projectId: p.id, projectName: p.name });
        }
      }
      return { locks };
    });

    // ---- agents: each user registers the agents that work for them ----
    app.get("/api/agents", { schema: { querystring: z.object({ all: z.string().optional() }) } }, async (req) => {
      const all = req.query.all && req.principal.user.role === "owner";
      return { agents: accounts.listAgents(all ? undefined : req.principal.user.username) };
    });

    // Users register agents in Settings; an assistant connected with its user's token may register one too.
    app.post("/api/agents", { schema: { body: CreateAgentBodySchema } }, async (req, reply) => {
      if (req.principal.via === "agent-token") throw new HttpError(403, "Agents cannot register agents");
      reply.code(201);
      return accounts.createAgent(req.principal.user.username, req.body.id, req.body.name);
    });

    const agentParams = z.object({ id: z.string().min(1).max(39) });
    const ownAgent = (req: FastifyRequest, id: string) => {
      const agent = accounts.getAgent(id);
      if (!agent) throw notFound(`Agent ${id}`);
      if (agent.owner !== req.principal.user.username) requireOwner(req);
      return agent;
    };
    app.post("/api/agents/:id/default", { schema: { params: agentParams } }, async (req) => {
      signedIn(req);
      return accounts.setDefaultAgent(ownAgent(req, req.params.id).id);
    });

    app.delete("/api/agents/:id", { schema: { params: agentParams } }, async (req) => {
      signedIn(req);
      return accounts.revokeAgent(ownAgent(req, req.params.id).id);
    });

    /** What deleting an agent removes, per project/template (`apply`: remove it, then the agent). */
    const footprint = async (id: string, apply: boolean) => {
      const projects: AgentFootprint["projects"] = [];
      for (const kind of KINDS) {
        for (const p of await workspace.list(kind)) {
          const nb = await workspace.open(kind, p.id);
          const comments = await nb.store.purgeCommentsOf(id, !apply);
          const notifications = await nb.notifications.purgeFrom(id, !apply);
          const locks = await nb.locks.dropHolder(id, !apply);
          if (comments.threads + comments.replies + comments.resolutions + notifications + locks) projects.push({ kind, id: p.id, name: p.name, ...comments, notifications, locks });
        }
      }
      const total = projects.reduce(
        (t, p) => ({ threads: t.threads + p.threads, replies: t.replies + p.replies, resolutions: t.resolutions + p.resolutions, notifications: t.notifications + p.notifications, locks: t.locks + p.locks }),
        { threads: 0, replies: 0, resolutions: 0, notifications: 0, locks: 0 },
      );
      return { agent: id, projects, total } satisfies AgentFootprint;
    };

    app.get("/api/agents/:id/footprint", { schema: { params: agentParams } }, async (req) => footprint(ownAgent(req, req.params.id).id, false));

    /**
     * Deletes an agent for good: its comments and replies (everywhere), its resolutions (threads reopen), its
     * notifications, its locks and its picture; the id becomes free. Returns what was removed.
     */
    app.post("/api/agents/:id/delete", { schema: { params: agentParams } }, async (req) => {
      signedIn(req);
      const agent = ownAgent(req, req.params.id);
      const removed = await footprint(agent.id, true);
      await avatars.remove(agent.id);
      await accounts.deleteAgent(agent.id);
      return removed;
    });

    // ---- pictures of users and agents (square, shown in circles) ----
    const avatarParams = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,38}$/) });
    /** Your own picture and your agents'; the owner may change anyone's. */
    const canChangeAvatar = (req: FastifyRequest, id: string) => {
      if (req.principal.via === "agent-token") throw new HttpError(403, "Agents cannot change pictures");
      const mine = id === req.principal.user.username || accounts.getAgent(id)?.owner === req.principal.user.username;
      if (!mine) requireOwner(req);
      if (!accounts.getUser(id) && !accounts.getAgent(id)) throw notFound(`User or agent ${id}`);
    };
    app.get("/api/avatars", async () => ({ avatars: await avatars.list() }));
    app.get("/api/avatars/:id", { schema: { params: avatarParams } }, async (req, reply) => {
      const file = avatars.file(req.params.id);
      if (!existsSync(file)) throw notFound(`Picture of ${req.params.id}`);
      return reply.type("image/webp").header("cache-control", "private, max-age=31536000, immutable").send(createReadStream(file));
    });
    app.put(
      "/api/avatars/:id",
      { schema: { params: avatarParams, body: z.object({ image: z.string().max(8_000_000) }) } },
      async (req) => {
        canChangeAvatar(req, req.params.id);
        const base64 = req.body.image.replace(/^data:image\/[\w+.-]+;base64,/, "");
        await avatars.save(req.params.id, Buffer.from(base64, "base64"));
        return { avatars: await avatars.list() };
      },
    );
    app.delete("/api/avatars/:id", { schema: { params: avatarParams } }, async (req) => {
      canChangeAvatar(req, req.params.id);
      await avatars.remove(req.params.id);
      return { avatars: await avatars.list() };
    });

    // ---- personal access tokens: one MCP configuration for all of a user's agents ----
    app.get("/api/tokens", { schema: { querystring: z.object({ all: z.string().optional() }) } }, async (req) => {
      const all = req.query.all && req.principal.user.role === "owner";
      return { tokens: accounts.listTokens(all ? undefined : req.principal.user.username) };
    });

    app.post("/api/tokens", { schema: { body: CreateAccessTokenBodySchema } }, async (req, reply) => {
      signedIn(req);
      reply.code(201);
      return accounts.createToken(req.principal.user.username, req.body.label);
    });

    app.delete("/api/tokens/:id", { schema: { params: z.object({ id: z.string().min(1).max(40) }) } }, async (req) => {
      signedIn(req);
      const t = accounts.getToken(req.params.id);
      if (!t) throw notFound(`Token ${req.params.id}`);
      if (t.owner !== req.principal.user.username) requireOwner(req);
      return accounts.revokeToken(t.id);
    });
  };
