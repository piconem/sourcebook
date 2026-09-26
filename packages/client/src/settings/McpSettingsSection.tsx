import type { McpSettingsView, UpdateMcpSettingsBody } from "@sourcebook/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "../api/client";
import { CopyField } from "../components/CopyField";
import { claudeCodeHttp, claudeCodeStdio, desktopJsonStdio, jsonHttp } from "./mcpSnippets";

export const mcpSettingsKey = ["settings", "mcp"] as const;

function Toggle(props: { checked: boolean; disabled?: boolean; onChange(v: boolean): void; label: ReactNode; description: ReactNode }) {
  return (
    <label className={`toggle-row${props.disabled ? " disabled" : ""}`}>
      <input type="checkbox" role="switch" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="toggle-switch" aria-hidden="true" />
      <span className="toggle-text">
        <strong>{props.label}</strong>
        <span className="muted small">{props.description}</span>
      </span>
    </label>
  );
}

/** Enable/disable the MCP server per transport, read-only access, and the parameters to configure an LLM client. */
export function McpSettingsSection() {
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: mcpSettingsKey, queryFn: api.getMcpSettings });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const update = async (body: UpdateMcpSettingsBody) => {
    setSaving(true);
    setSaveError(null);
    try {
      qc.setQueryData<McpSettingsView>(mcpSettingsKey, await api.updateMcpSettings(body));
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error) return <p className="render-error">{(error as Error).message}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { http, stdio } = data.connection;
  return (
    <div className="mcp-settings">
      <p className="muted small">
        The MCP server lets an AI assistant (Claude Code, Claude Desktop, other MCP clients) read and edit your projects and templates
        with you. Changes apply immediately; the Sourcebook server must be running.
      </p>

      <section className="mcp-mode">
        <Toggle
          checked={data.http.enabled}
          disabled={saving}
          onChange={(v) => update({ http: { enabled: v } })}
          label="HTTP"
          description="Built into the Sourcebook server; the client connects to a URL (local requests only)."
        />
        {data.http.enabled ? (
          <div className="mcp-params">
            <CopyField label="Server URL" value={http.url} />
            <CopyField label="Claude Code" value={claudeCodeHttp(http.url)} />
            <CopyField label="Other clients (JSON)" value={jsonHttp(http.url)} multiline />
          </div>
        ) : (
          <p className="muted small mcp-off">Disabled: requests to {http.url} are refused.</p>
        )}
      </section>

      <section className="mcp-mode">
        <Toggle
          checked={data.stdio.enabled}
          disabled={saving}
          onChange={(v) => update({ stdio: { enabled: v } })}
          label="stdio"
          description="The client starts a local process that talks to Sourcebook."
        />
        {data.stdio.enabled ? (
          <div className="mcp-params">
            <CopyField label="Command" value={stdio.command} />
            <CopyField label="Arguments" value={stdio.args.join(" ")} />
            <CopyField label="Working directory" value={stdio.cwd} />
            {Object.keys(stdio.env).length > 0 && (
              <CopyField label="Environment" value={Object.entries(stdio.env).map(([k, v]) => `${k}=${v}`).join("\n")} multiline />
            )}
            <CopyField label="Claude Code" value={claudeCodeStdio(stdio)} />
            <CopyField label="Claude Desktop (claude_desktop_config.json)" value={desktopJsonStdio(stdio)} multiline />
          </div>
        ) : (
          <p className="muted small mcp-off">Disabled: the stdio process can start, but Sourcebook refuses its requests.</p>
        )}
      </section>

      <section className="mcp-mode">
        <Toggle
          checked={data.readOnly}
          disabled={saving}
          onChange={(v) => update({ readOnly: v })}
          label="Read-only access"
          description="The assistant can read everything but cannot create, change or delete anything (including comments)."
        />
      </section>
      {saveError && <p className="render-error">{saveError}</p>}
    </div>
  );
}
