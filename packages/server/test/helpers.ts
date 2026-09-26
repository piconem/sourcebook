import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const tempProject = () => mkdtemp(join(tmpdir(), "sourcebook-test-"));
export const ls = async (dir: string) => (await readdir(dir)).sort();
export const readJsonFile = async (p: string) => JSON.parse(await readFile(p, "utf8"));

// 1x1 transparent PNG
export const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

import { existsSync } from "node:fs";
import type { InjectOptions } from "fastify";
import { buildApp } from "../src/app.js";

/** Rewrites single-project URLs (/api/blocks/…) to the project-scoped API (/api/projects/<id>/blocks/…). */
export function scopeUrl(url: string, id = "test", kind = "projects") {
  const base = `/api/${kind}/${id}`;
  return url
    .replace(/^\/api\/project(?=$|\?)/, `${base}/notebook`)
    .replace(/^\/api\/project\/(markdown|export)/, `${base}/$1`)
    .replace(/^\/api\/(blocks|assets|references)/, `${base}/$1`);
}

/**
 * A workspace (temp dir unless given) with one project "test"; `app.inject` accepts the single-project
 * URLs used by the tests. `root` is the project folder.
 */
export async function buildProjectApp(opts: { workspace?: string; configDir?: string } = {}) {
  const workspace = opts.workspace ?? (await tempProject());
  const { app: server } = await buildApp(workspace, { configDir: opts.configDir });
  if (!existsSync(join(workspace, "projects", "test"))) {
    const res = await server.inject({ method: "POST", url: "/api/projects", payload: { name: "Test" } });
    if (res.statusCode !== 201) throw new Error(res.body);
  }
  const app = {
    inject: (o: InjectOptions) => server.inject({ ...o, url: scopeUrl(String(o.url)) }),
  };
  return { app, server, workspace, root: join(workspace, "projects", "test") };
}
