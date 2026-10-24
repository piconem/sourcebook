import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { HttpError } from "./errors.js";
import { requestContext } from "./requestContext.js";
import { createServerRegistry } from "./registry.js";
import { assetRoutes } from "./routes/assets.js";
import { bibliographyRoutes } from "./routes/bibliography.js";
import { blockRoutes } from "./routes/blocks.js";
import { notificationRoutes } from "./routes/notifications.js";
import { commentRoutes } from "./routes/comments.js";
import { mcpRoutes } from "./routes/mcp.js";
import { settingsRoutes } from "./routes/settings.js";
import { SettingsStore } from "./store/SettingsStore.js";
import { MCP_TRANSPORT_HEADER } from "@sourcebook/shared";
import { projectRoutes } from "./routes/project.js";
import { referenceRoutes } from "./routes/references.js";
import { referenceImageRoutes } from "./routes/referenceImages.js";
import { subBlockRoutes } from "./routes/subblocks.js";
import { workspaceRoutes } from "./routes/workspace.js";
import { seedTemplates } from "./seed/seedTemplates.js";
import { UserStore, defaultConfigDir } from "./store/UserStore.js";
import { KINDS, WorkspaceStore, type NotebookContext } from "./store/WorkspaceStore.js";
import { AccountStore } from "./store/AccountStore.js";
import { authHook, type AuthOptions } from "./auth.js";
import { authRoutes } from "./routes/auth.js";
import { notFound } from "./errors.js";
import { clientRoutes } from "./routes/client.js";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { UserProfile } from "@sourcebook/shared";

declare module "fastify" {
  interface FastifyRequest {
    /** The project/template addressed by the URL (set for /api/{projects,templates}/:projectId/…). */
    nb: NotebookContext;
  }
  interface FastifyInstance {
    /** URL prefix of every route ("" at the root), e.g. "/marco/sourcebook". */
    basePath: string;
  }
}

export interface AppOptions {
  logger?: boolean;
  /** Per-person config dir of older versions (user.json, settings.json): imported on the first start. */
  configDir?: string;
  port?: number;
  /** Accounts and sign-in (default true). false: single-user mode for tests — every request acts as the owner. */
  auth?: boolean;
  /** URL prefix, normalized ("" or "/a/b"). */
  basePath?: string;
  /** Address users reach Sourcebook at, with the base path (connection hints, secure cookies). */
  publicUrl?: string;
  /** Initial owner password (first start); otherwise one is generated. */
  adminPassword?: string;
  trustProxy?: boolean;
  /** Built web client to serve (default packages/client/dist, when it exists). */
  clientDist?: string | null;
  /** Offer the MCP server over stdio (default true; off in a container, see config.ts). */
  mcpStdio?: boolean;
  /** Add the templates shipped with Sourcebook (Sourcebook Demo) to the workspace, once each (default false). */
  seedTemplates?: boolean;
}

/** Owner account of a new installation: the profile of an older version, the OS login of an existing workspace, or "admin". */
async function ownerProfile(workspaceDir: string, configDir: string): Promise<UserProfile> {
  const legacy = new UserStore(configDir);
  if (existsSync(join(configDir, "user.json"))) return legacy.get();
  const existing = (await readdir(join(workspaceDir, "projects")).catch(() => [])).length > 0;
  return existing ? legacy.get() : { name: "Administrator", username: "admin" };
}

const MAX_BODY = 50 * 1024 * 1024; // exported PNGs travel as base64 in JSON bodies

/**
 * `workspaceDir` holds `projects/` and `templates/`; `configDir` holds per-person settings (user profile,
 * default ~/.config/sourcebook).
 */
export async function buildApp(workspaceDir: string, opts: AppOptions = {}) {
  const registry = createServerRegistry();
  const workspace = new WorkspaceStore(workspaceDir, registry);
  await workspace.init();
  const configDir = opts.configDir ?? defaultConfigDir();
  const basePath = opts.basePath ?? "";
  const port = opts.port ?? 4000;
  const publicUrl = opts.publicUrl ?? `http://127.0.0.1:${port}${basePath}`;
  const stdioAvailable = opts.mcpStdio ?? true;
  const accounts = new AccountStore(workspaceDir);
  const { generatedPassword } = await accounts.load({ owner: await ownerProfile(workspaceDir, configDir), password: opts.adminPassword });
  const settings = await new SettingsStore(accounts.dir, configDir).load();
  const seededTemplates = opts.seedTemplates ? await seedTemplates(workspaceDir, accounts.dir, registry) : [];
  const auth: AuthOptions = { enabled: opts.auth ?? true, accounts, basePath, secureCookie: publicUrl.startsWith("https:") };
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: MAX_BODY, trustProxy: !!opts.trustProxy }).withTypeProvider<ZodTypeProvider>();
  app.decorate("basePath", basePath);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Remember which client (web tab, MCP, script) makes each request: live events carry it as `origin`.
  app.addHook("onRequest", (req, reply, done) => {
    const origin = String(req.headers["x-sourcebook-client"] ?? "api").slice(0, 100);
    // Requests made by the MCP server obey the MCP settings (transport enabled, read-only).
    const transport = req.headers[MCP_TRANSPORT_HEADER];
    const readingSettings = req.method === "GET" && req.url.startsWith(`${basePath}/api/settings/mcp`);
    if (origin === "mcp" && transport && !readingSettings) {
      const mcp = settings.getMcp();
      const blocked =
        transport === "stdio" && !stdioAvailable
          ? "The Sourcebook MCP server over stdio is not available in this installation (it runs in a container): connect over HTTP."
          : transport === "stdio" && !mcp.stdio.enabled
            ? "The Sourcebook MCP server over stdio is disabled (Settings → AI assistant)."
            : transport === "http" && !mcp.http.enabled
              ? "The Sourcebook MCP server over HTTP is disabled (Settings → AI assistant)."
              : mcp.readOnly && req.method !== "GET" && req.method !== "HEAD"
                ? "The assistant has read-only access to Sourcebook (Settings → AI assistant)."
                : null;
      if (blocked) {
        reply.code(403).send({ error: blocked });
        return;
      }
    }
    requestContext.run({ origin }, done);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({ error: "Invalid request", details: err.validation });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message, details: err.details });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: (err as Error).message });
  });

  // Who makes the request: web session or agent token (after the MCP-settings hook above).
  app.addHook("onRequest", authHook(auth));

  await app.register(fastifyMultipart, { limits: { fileSize: MAX_BODY, files: 1 } }); // per-route overrides allowed
  await app.register(fastifyStatic, { root: workspaceDir, serve: false });
  // Every route lives under the base path.
  await app.register(
    async (scope) => {
      await scope.register(authRoutes(auth, workspace));
      await scope.register(settingsRoutes(settings, { publicUrl, basePath, stdioAvailable }));
      await scope.register(
        workspaceRoutes(workspace, accounts, () => registry.list().map((t) => ({ type: t.type, label: t.label, sourceExt: t.sourceExt }))),
      );
      // The same notebook API for every project and every template, for those with access to it.
      for (const kind of KINDS) {
        await scope.register(
          async (scoped) => {
            scoped.addHook("onRequest", async (req) => {
              const id = (req.params as { projectId: string }).projectId;
              const level = accounts.accessLevel(req.principal.user, kind, id);
              if (!level) throw notFound(`${kind === "projects" ? "Project" : "Template"} ${id}`);
              const needed = req.routeOptions.config?.access ?? (req.method === "GET" || req.method === "HEAD" ? "read" : "write");
              if (needed === "write" && level !== "write") throw new HttpError(403, "You have read-only access to this project (you can comment)");
              req.access = level;
              req.nb = await workspace.open(kind, id);
            });
            await scoped.register(projectRoutes());
            await scoped.register(blockRoutes());
            await scoped.register(subBlockRoutes());
            await scoped.register(assetRoutes());
            await scoped.register(referenceRoutes());
            await scoped.register(referenceImageRoutes());
            await scoped.register(bibliographyRoutes());
            await scoped.register(commentRoutes(auth.enabled, accounts));
            await scoped.register(notificationRoutes(auth.enabled));
          },
          { prefix: `/api/${kind}/:projectId` },
        );
      }
      // MCP (Streamable HTTP) for LLM assistants; the stdio variant is packages/mcp/src/stdio.ts.
      await scope.register(mcpRoutes(app, settings, { basePath, publicUrl, authEnabled: auth.enabled }));
      // The web client (built), when available.
      if (opts.clientDist !== null) await scope.register(clientRoutes(opts.clientDist, basePath));
    },
    { prefix: basePath },
  );
  if (basePath) app.get("/", async (_req, reply) => reply.redirect(`${basePath}/`));
  return { app, workspace, accounts, initialAdminPassword: generatedPassword, seededTemplates };
}
