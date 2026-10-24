import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { UpdateMcpSettingsBodySchema, type McpSettingsView } from "@sourcebook/shared";
import { requireOwner } from "../auth.js";
import { badRequest } from "../errors.js";
import { REPO_ROOT } from "../paths.js";
import type { SettingsStore } from "../store/SettingsStore.js";

/** Placeholder shown in connection hints: each user puts their access token (Settings → My agents). */
export const TOKEN_PLACEHOLDER = "<your access token>";

/** MCP settings (only the owner changes them) and the parameters LLM clients need to connect to this server. */
export const settingsRoutes =
  (settings: SettingsStore, where: { publicUrl: string; basePath: string; stdioAvailable: boolean }): FastifyPluginAsyncZod =>
  async (app) => {
    const view = (): McpSettingsView => {
      const mcp = settings.getMcp();
      return {
        ...mcp,
        stdio: { enabled: where.stdioAvailable && mcp.stdio.enabled, available: where.stdioAvailable },
        connection: {
          http: { url: `${where.publicUrl}/mcp`, headers: { Authorization: `Bearer ${TOKEN_PLACEHOLDER}` } },
          stdio: where.stdioAvailable ? stdio() : null,
        },
      };
    };
    // A process started by the AI client on this machine, from this checkout of Sourcebook.
    const stdio = () => ({
      command: "pnpm",
      args: ["--silent", "--dir", REPO_ROOT, "--filter", "@sourcebook/mcp", "exec", "tsx", "src/stdio.ts"],
      cwd: REPO_ROOT,
      env: {
        ...(where.publicUrl === "http://127.0.0.1:4000" ? {} : { SOURCEBOOK_URL: where.publicUrl }),
        SOURCEBOOK_TOKEN: TOKEN_PLACEHOLDER,
      },
    });
    app.get("/api/settings/mcp", async () => view());
    app.put("/api/settings/mcp", { schema: { body: UpdateMcpSettingsBodySchema } }, async (req) => {
      requireOwner(req);
      if (req.body.stdio?.enabled && !where.stdioAvailable) throw badRequest("stdio is not available in this installation (it runs in a container): use HTTP");
      await settings.updateMcp(req.body);
      return view();
    });
  };
