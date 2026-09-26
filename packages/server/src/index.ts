import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildApp } from "./app.js";

const { values } = parseArgs({
  options: { workspace: { type: "string" }, port: { type: "string" } },
});
// Folder holding projects/ and templates/.
const workspaceDir = resolve(values.workspace ?? process.env.SOURCEBOOK_WORKSPACE ?? join(homedir(), "Sourcebook"));
const port = Number(values.port ?? process.env.PORT ?? 4000);

const { app } = await buildApp(workspaceDir, { logger: true, port });
await app.listen({ port, host: "127.0.0.1" });
app.log.info(`Sourcebook workspace: ${workspaceDir}`);
