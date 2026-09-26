import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { McpSettingsSchema, type McpSettings, type UpdateMcpSettingsBody } from "@sourcebook/shared";
import { readJson, writeJsonAtomic } from "../fs/atomic.js";
import { defaultConfigDir } from "./UserStore.js";

export const DEFAULT_MCP_SETTINGS: McpSettings = { http: { enabled: true }, stdio: { enabled: true }, readOnly: false };

/**
 * Per-person application settings (settings.json next to user.json). Loaded once and kept in memory, because
 * they are checked on every request coming from the MCP server.
 */
export class SettingsStore {
  private readonly path: string;
  private mcp: McpSettings = structuredClone(DEFAULT_MCP_SETTINGS);

  constructor(private readonly configDir = defaultConfigDir()) {
    this.path = join(configDir, "settings.json");
  }

  async load(): Promise<this> {
    if (existsSync(this.path)) {
      const raw = (await readJson(this.path).catch(() => null)) as { mcp?: unknown } | null;
      const parsed = McpSettingsSchema.safeParse(raw?.mcp);
      if (parsed.success) this.mcp = parsed.data;
    }
    return this;
  }

  getMcp(): McpSettings {
    return structuredClone(this.mcp);
  }

  async updateMcp(body: UpdateMcpSettingsBody): Promise<McpSettings> {
    this.mcp = {
      http: body.http ?? this.mcp.http,
      stdio: body.stdio ?? this.mcp.stdio,
      readOnly: body.readOnly ?? this.mcp.readOnly,
    };
    await mkdir(this.configDir, { recursive: true });
    const existing = existsSync(this.path) ? ((await readJson(this.path).catch(() => ({}))) as object) : {};
    await writeJsonAtomic(this.path, { ...existing, mcp: this.mcp });
    return this.getMcp();
  }
}
