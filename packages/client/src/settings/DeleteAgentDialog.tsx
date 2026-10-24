import type { AgentFootprint, AgentView } from "@sourcebook/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Dialog } from "../components/Dialog";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "2 comment threads, 1 reply, …" — only the non-zero parts. */
export function footprintSummary(t: AgentFootprint["total"]): string {
  const parts = [
    t.threads && plural(t.threads, "comment thread"),
    t.replies && plural(t.replies, "reply", "replies"),
    t.resolutions && `${plural(t.resolutions, "resolution")} (those threads reopen)`,
    t.notifications && plural(t.notifications, "notification"),
    t.locks && plural(t.locks, "lock"),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "nothing in the projects";
}

/**
 * Deleting an agent for good: shows what will be removed in every project (from the server, nothing changes yet)
 * and asks to type the agent's id to confirm.
 */
export function DeleteAgentDialog(props: { agent: AgentView | null; onClose(): void; onDeleted(removed: AgentFootprint, agent: AgentView): void }) {
  const { agent } = props;
  const { data: preview, error } = useQuery({ queryKey: ["agent-footprint", agent?.id], queryFn: () => api.agentFootprint(agent!.id), enabled: !!agent, staleTime: 0 });
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    setTyped("");
    setFailure(null);
  }, [agent]);

  const remove = async () => {
    if (!agent) return;
    setBusy(true);
    setFailure(null);
    try {
      props.onDeleted(await api.deleteAgent(agent.id), agent);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!agent}
      title={`Delete ${agent?.name ?? ""} permanently?`}
      onClose={props.onClose}
      actions={
        <>
          <button onClick={props.onClose}>Cancel</button>
          <button className="danger solid" disabled={busy || !preview || typed !== agent?.id} onClick={remove}>
            {busy ? "Deleting…" : "Delete permanently"}
          </button>
        </>
      }
    >
      {agent && (
        <div className="delete-agent">
          <p>
            Everything <strong>{agent.name}</strong> (agent: "{agent.id}") did is removed from every project and template. This cannot be
            undone; the id <code>{agent.id}</code> becomes free for a new agent. To only stop it and keep its history, use <em>Revoke</em>.
          </p>
          {error ? (
            <p className="render-error">{(error as Error).message}</p>
          ) : !preview ? (
            <p className="muted small">Looking for what it left in the projects…</p>
          ) : (
            <>
              <p>
                <strong>Will be removed:</strong> {footprintSummary(preview.total)}, its picture and the agent itself.
              </p>
              {preview.projects.length > 0 && (
                <ul className="file-list small">
                  {preview.projects.map((p) => (
                    <li key={`${p.kind}/${p.id}`}>
                      {p.name}
                      {p.kind === "templates" ? " (template)" : ""}: {footprintSummary(p)}
                    </li>
                  ))}
                </ul>
              )}
              {preview.total.threads > 0 && <p className="muted small">Replies other people wrote in its threads are removed with them.</p>}
            </>
          )}
          <label className="field">
            <span>
              Type <code>{agent.id}</code> to confirm
            </span>
            <input value={typed} onChange={(e) => setTyped(e.target.value.trim())} aria-label="Agent id to confirm" />
          </label>
          {failure && <p className="render-error">{failure}</p>}
        </div>
      )}
    </Dialog>
  );
}
