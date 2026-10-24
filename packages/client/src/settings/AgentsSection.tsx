import { UsernameSchema, type AccessTokenView, type AgentFootprint, type AgentView } from "@sourcebook/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { useAuth, useIsOwner } from "../auth/AuthContext";
import { CopyField } from "../components/CopyField";
import { Avatar } from "../components/Avatar";
import { AvatarPicker } from "../components/AvatarPicker";
import { fullTime, relativeTime } from "../comments/time";
import { suggestUsername } from "../components/SettingsDialog";
import { mcpSettingsKey } from "./McpSettingsSection";
import { DeleteAgentDialog, footprintSummary } from "./DeleteAgentDialog";
import { CODEX_TOKEN_VAR, claudeCodeHttp, claudeCodeStdio, codexHttp, geminiHttp, jsonHttp, mcpJsonWithEnvToken, shellQuote, withToken } from "./mcpSnippets";

const lastUsed = (x: { lastUsedAt?: string; revoked: boolean }) => (x.revoked ? "revoked" : x.lastUsedAt ? relativeTime(x.lastUsedAt) : "never");

/**
 * How the user's AI agents reach Sourcebook: access tokens (one MCP configuration for all agents) and the agents'
 * identities (each call names one; the default acts otherwise). The owner may list everybody's.
 */
export function AgentsSection() {
  const qc = useQueryClient();
  const owner = useIsOwner();
  const me = useAuth()?.me;
  const [all, setAll] = useState(false);
  const { data: tokens = [] } = useQuery({ queryKey: ["tokens", all], queryFn: () => api.listTokens(all) });
  const { data: agents = [], error } = useQuery({ queryKey: ["agents", all], queryFn: () => api.listAgents(all) });
  const { data: mcp } = useQuery({ queryKey: mcpSettingsKey, queryFn: api.getMcpSettings });
  const [label, setLabel] = useState("");
  const [issued, setIssued] = useState<{ token: string; info: AccessTokenView } | null>(null);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AgentView | null>(null);
  const [deleted, setDeleted] = useState<{ agent: AgentView; removed: AgentFootprint } | null>(null);
  const idError = id && UsernameSchema.safeParse(id).error?.issues[0]?.message;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["agents"] }), qc.invalidateQueries({ queryKey: ["tokens"] })]);
  const run = async (fn: () => Promise<unknown>) => {
    setFailure(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setFailure((e as Error).message);
    }
  };
  const connection = issued && mcp ? withToken(mcp.connection, issued.token) : null;
  const who = me?.user.name ?? "you";

  return (
    <div className="agents-settings">
      <p className="muted small">
        Configure the Sourcebook MCP server <strong>once</strong> in your AI client with an access token. Then any number of agents
        (a writer, a reviewer…) share it: each call names the agent acting (<code>agent: "reviewer"</code>), or your default agent acts.
        Agents have your rights and sign as “Reviewer · for {who}”.
      </p>

      <h3 className="settings-section">Access tokens</h3>
      {issued && (
        <section className="agent-created" role="status">
          <strong>Token “{issued.info.label}” created.</strong> Copy it now: it will not be shown again.
          <CopyField label="Token" value={issued.token} />
          {connection && mcp && (
            <>
              <CopyField label="Claude Code (HTTP)" value={claudeCodeHttp(connection.http)} />
              <CopyField
                label="Claude Code project file .mcp.json — commit it; start each session with SOURCEBOOK_TOKEN=… claude"
                value={mcpJsonWithEnvToken(mcp.connection.http)}
                multiline
              />
              <CopyField label="Gemini CLI" value={geminiHttp(connection.http)} />
              <CopyField
                label="OpenAI Codex — set the variable where you start codex (e.g. your shell profile)"
                value={`export ${CODEX_TOKEN_VAR}=${shellQuote(issued.token)}\n${codexHttp(connection.http)}`}
                multiline
              />
              {connection.stdio && <CopyField label="Claude Code (stdio)" value={claudeCodeStdio(connection.stdio)} />}
              <CopyField label="Other clients (JSON, HTTP)" value={jsonHttp(connection.http)} multiline />
            </>
          )}
          <button className="link small" onClick={() => setIssued(null)}>
            Done, I copied it
          </button>
        </section>
      )}
      <div className="agent-form">
        <label className="field">
          <span>New token — what is it for?</span>
          <input value={label} placeholder="Laptop – Claude Code" onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button
          className="primary"
          disabled={!label.trim()}
          onClick={() =>
            run(async () => {
              setIssued(await api.createToken(label.trim()));
              setLabel("");
            })
          }
        >
          Create token
        </button>
      </div>
      {tokens.length > 0 && (
        <table className="settings-table">
          <thead>
            <tr>
              <th>Token</th>
              {all && <th>Of</th>}
              <th>Last used</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id} className={t.revoked ? "muted" : ""}>
                <td>
                  <strong>{t.label}</strong> <code className="muted">{t.prefix}…</code>
                </td>
                {all && <td>{t.ownerName}</td>}
                <td title={t.lastUsedAt ? fullTime(t.lastUsedAt) : undefined}>{lastUsed(t)}</td>
                <td>
                  {!t.revoked && (
                    <button className="link danger small" onClick={() => window.confirm(`Revoke “${t.label}”? Clients using it stop working.`) && run(() => api.revokeToken(t.id))}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="settings-section">
        {all ? "All agents" : "My agents"}
        {owner && (
          <label className="check small settings-inline">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> show everybody's
          </label>
        )}
      </h3>
      <p className="muted small">Identities of your agents. They can also register themselves (MCP tool register_agent).</p>
      <div className="agent-form">
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            placeholder="Reviewer"
            onChange={(e) => {
              setName(e.target.value);
              if (!idTouched) setId(suggestUsername(e.target.value));
            }}
          />
        </label>
        <label className="field">
          <span>Id (used as agent: "…")</span>
          <div className="input-prefix">
            <span aria-hidden="true">@</span>
            <input
              value={id}
              placeholder="reviewer"
              onChange={(e) => {
                setIdTouched(true);
                setId(e.target.value.trim());
              }}
            />
          </div>
          {idError && <span className="field-error">{idError}</span>}
        </label>
        <button
          className="primary"
          disabled={!name.trim() || !id || !!idError}
          onClick={() =>
            run(async () => {
              await api.createAgent(id, name.trim());
              setName("");
              setId("");
              setIdTouched(false);
            })
          }
        >
          Add agent
        </button>
      </div>
      {failure && <p className="render-error">{failure}</p>}
      {deleted && (
        <section className="agent-created" role="status">
          <strong>{deleted.agent.name} was deleted.</strong>
          <span>
            Removed {footprintSummary(deleted.removed.total)}
            {deleted.removed.projects.length > 0 && ` in ${deleted.removed.projects.map((p) => p.name).join(", ")}`}, and its picture. The id
            “{deleted.agent.id}” is free again.
          </span>
          <button className="link small" onClick={() => setDeleted(null)}>
            OK
          </button>
        </section>
      )}
      <DeleteAgentDialog
        agent={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(removed, agent) => {
          setDeleting(null);
          setDeleted({ agent, removed });
          void refresh();
          void qc.invalidateQueries({ queryKey: ["avatars"] });
          void qc.invalidateQueries({ queryKey: ["comments"] });
          void qc.invalidateQueries({ queryKey: ["project-comments"] });
          void qc.invalidateQueries({ queryKey: ["notifications"] });
          void qc.invalidateQueries({ queryKey: ["locks"] });
        }}
      />
      {error ? (
        <p className="render-error">{(error as Error).message}</p>
      ) : agents.length === 0 ? (
        <p className="muted small">No agents yet.</p>
      ) : (
        <table className="settings-table">
          <thead>
            <tr>
              <th>Agent</th>
              {all && <th>Works for</th>}
              <th>Last active</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {agents.map((a: AgentView) => (
              <tr key={a.id} className={a.revoked ? "muted" : ""}>
                <td className="agent-cell">
                  {a.revoked ? <Avatar name={a.name} username={a.id} size={28} /> : <AvatarPicker id={a.id} name={a.name} size={28} compact />}
                  <strong>{a.name}</strong> <span className="muted">agent: "{a.id}"</span>
                  {a.default && <span className="badge-default"> default</span>}
                </td>
                {all && <td>{a.ownerName}</td>}
                <td title={a.lastUsedAt ? fullTime(a.lastUsedAt) : undefined}>{lastUsed(a)}</td>
                <td className="settings-actions">
                  {!a.revoked && !a.default && (
                    <button className="link small" onClick={() => run(() => api.setDefaultAgent(a.id))}>
                      Make default
                    </button>
                  )}
                  {!a.revoked && (
                    <button
                      className="link small"
                      title="Stop it: calls naming it are refused; its comments and history stay"
                      onClick={() => window.confirm(`Revoke ${a.name}? Calls naming it will be refused; what it wrote stays.`) && run(() => api.revokeAgent(a.id))}
                    >
                      Revoke
                    </button>
                  )}
                  <button className="link danger small" title="Remove it and everything it wrote, everywhere" onClick={() => setDeleting(a)}>
                    Delete…
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
