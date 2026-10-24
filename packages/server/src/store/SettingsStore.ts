import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { McpSettingsSchema, type McpSettings, type UpdateMcpSettingsBody } from "@sourcebook/shared";
import { readJson, writeJsonAtomic } from "../fs/atomic.js";

export const DEFAULT_MCP_SETTINGS: McpSettings = { http: { enabled: true }, stdio: { enabled: true }, readOnly: false };

/**
 * Settings of this Sourcebook (`<workspace>/.sourcebook/settings.json`). Loaded once and kept in memory, because
 * they are checked on every request coming from the MCP server. `legacyDir`: where older versions kept them
 * (per-person config dir), read when the new file does not exist yet.
 */
export class SettingsStore {
  private readonly path: string;
  private mcp: McpSettings = structuredClone(DEFAULT_MCP_SETTINGS);

  constructor(
    private readonly dir: string,
    private readonly legacyDir?: string,
  ) {
    this.path = join(dir, "settings.json");
  }

  async load(): Promise<this> {
    const legacy = this.legacyDir ? join(this.legacyDir, "settings.json") : null;
    const source = existsSync(this.path) ? this.path : legacy && existsSync(legacy) ? legacy : null;
    if (source) {
      const raw = (await readJson(source).catch(() => null)) as { mcp?: unknown } | null;
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
    await mkdir(this.dir, { recursive: true });
    const existing = existsSync(this.path) ? ((await readJson(this.path).catch(() => ({}))) as object) : {};
    await writeJsonAtomic(this.path, { ...existing, mcp: this.mcp }, 0o600);
    return this.getMcp();
  }
}
