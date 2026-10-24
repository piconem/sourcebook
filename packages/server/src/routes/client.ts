import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../paths.js";

/**
 * Serves the built web client (`pnpm --filter @sourcebook/client build`) under the base path. It is built with
 * relative asset URLs, so one build works under any prefix; index.html receives the base path at runtime.
 */
export function clientRoutes(dist: string | undefined, basePath: string) {
  const root = dist ?? process.env.SOURCEBOOK_CLIENT_DIST ?? join(REPO_ROOT, "packages", "client", "dist");
  return async (app: FastifyInstance) => {
    const indexFile = join(root, "index.html");
    if (!existsSync(indexFile)) return; // development: Vite serves the client
    const config = `<script>window.__SOURCEBOOK__=${JSON.stringify({ basePath })}</script>`;
    const index = readFileSync(indexFile, "utf8").replace("</head>", `${config}</head>`);
    const sendIndex = async (_req: unknown, reply: FastifyReply) => reply.type("text/html; charset=utf-8").header("cache-control", "no-cache").send(index);
    // Only "<base>/": without the slash, relative asset URLs would resolve outside the base path.
    app.get("/", { prefixTrailingSlash: basePath ? "slash" : "both" }, sendIndex);
    app.get("/index.html", sendIndex);
    if (basePath) app.get("", async (_req, reply) => reply.redirect(`${basePath}/`));
    await app.register(fastifyStatic, { root, prefix: "/", index: false, decorateReply: false, wildcard: true });
  };
}
