import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { UpdateMcpSettingsBodySchema, type McpSettingsView } from "@sourcebook/shared";
import { REPO_ROOT } from "../paths.js";
import type { SettingsStore } from "../store/SettingsStore.js";

/** MCP settings and the parameters LLM clients need to connect to this server. */
export const settingsRoutes =
  (settings: SettingsStore, port: number): FastifyPluginAsyncZod =>
  async (app) => {
    const view = (): McpSettingsView => ({
      ...settings.getMcp(),
      connection: {
        http: { url: `http://127.0.0.1:${port}/mcp` },
        stdio: {
          command: "pnpm",
          args: ["--silent", "--dir", REPO_ROOT, "--filter", "@sourcebook/mcp", "exec", "tsx", "src/stdio.ts"],
          cwd: REPO_ROOT,
          env: port === 4000 ? {} : { SOURCEBOOK_URL: `http://127.0.0.1:${port}` },
        },
      },
    });
    app.get("/api/settings/mcp", async () => view());
    app.put("/api/settings/mcp", { schema: { body: UpdateMcpSettingsBodySchema } }, async (req) => {
      await settings.updateMcp(req.body);
      return view();
    });
  };
