import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { UpdateMcpSettingsBodySchema, type McpSettingsView } from "@sourcebook/shared";
import { requireOwner } from "../auth.js";
import { REPO_ROOT } from "../paths.js";
import type { SettingsStore } from "../store/SettingsStore.js";

/** Placeholder shown in connection hints: each user puts their access token (Settings → My agents). */
export const TOKEN_PLACEHOLDER = "<your access token>";

/** MCP settings (only the owner changes them) and the parameters LLM clients need to connect to this server. */
export const settingsRoutes =
  (settings: SettingsStore, where: { publicUrl: string; basePath: string }): FastifyPluginAsyncZod =>
  async (app) => {
    const view = (): McpSettingsView => ({
      ...settings.getMcp(),
      connection: {
        http: { url: `${where.publicUrl}/mcp`, headers: { Authorization: `Bearer ${TOKEN_PLACEHOLDER}` } },
        stdio: {
          command: "pnpm",
          args: ["--silent", "--dir", REPO_ROOT, "--filter", "@sourcebook/mcp", "exec", "tsx", "src/stdio.ts"],
          cwd: REPO_ROOT,
          env: {
            ...(where.publicUrl === "http://127.0.0.1:4000" ? {} : { SOURCEBOOK_URL: where.publicUrl }),
            SOURCEBOOK_TOKEN: TOKEN_PLACEHOLDER,
          },
        },
      },
    });
    app.get("/api/settings/mcp", async () => view());
    app.put("/api/settings/mcp", { schema: { body: UpdateMcpSettingsBodySchema } }, async (req) => {
      requireOwner(req);
      await settings.updateMcp(req.body);
      return view();
    });
  };
