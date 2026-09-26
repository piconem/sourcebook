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
import { createServerRegistry } from "./registry.js";
import { assetRoutes } from "./routes/assets.js";
import { blockRoutes } from "./routes/blocks.js";
import { commentRoutes } from "./routes/comments.js";
import { projectRoutes } from "./routes/project.js";
import { referenceRoutes } from "./routes/references.js";
import { subBlockRoutes } from "./routes/subblocks.js";
import { workspaceRoutes } from "./routes/workspace.js";
import { UserStore } from "./store/UserStore.js";
import { KINDS, WorkspaceStore, type NotebookContext } from "./store/WorkspaceStore.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The project/template addressed by the URL (set for /api/{projects,templates}/:projectId/…). */
    nb: NotebookContext;
  }
}

const MAX_BODY = 50 * 1024 * 1024; // exported PNGs travel as base64 in JSON bodies

/**
 * `workspaceDir` holds `projects/` and `templates/`; `configDir` holds per-person settings (user profile,
 * default ~/.config/sourcebook).
 */
export async function buildApp(workspaceDir: string, opts: { logger?: boolean; configDir?: string } = {}) {
  const registry = createServerRegistry();
  const workspace = new WorkspaceStore(workspaceDir, registry);
  await workspace.init();
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: MAX_BODY }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

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

  await app.register(fastifyMultipart, { limits: { fileSize: MAX_BODY, files: 1 } }); // per-route overrides allowed
  await app.register(fastifyStatic, { root: workspaceDir, serve: false });
  const users = new UserStore(opts.configDir);
  await app.register(
    workspaceRoutes(workspace, users, () => registry.list().map((t) => ({ type: t.type, label: t.label, sourceExt: t.sourceExt }))),
  );
  // The same notebook API for every project and every template.
  for (const kind of KINDS) {
    await app.register(
      async (scoped) => {
        scoped.addHook("onRequest", async (req) => {
          req.nb = await workspace.open(kind, (req.params as { projectId: string }).projectId);
        });
        await scoped.register(projectRoutes());
        await scoped.register(blockRoutes());
        await scoped.register(subBlockRoutes());
        await scoped.register(assetRoutes());
        await scoped.register(referenceRoutes());
        await scoped.register(commentRoutes(users));
      },
      { prefix: `/api/${kind}/:projectId` },
    );
  }
  return { app, workspace };
}
