import { CreateUserBodySchema, type AccessLevel, type AccountView, type NotebookKind } from "@sourcebook/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CopyField } from "../components/CopyField";
import { suggestUsername } from "../components/SettingsDialog";

const usersKey = ["users"] as const;
const accessKey = ["access"] as const;
const locksKey = ["all-locks"] as const;

const randomPassword = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 57]).join("");

/** Owner: user accounts (add with a temporary password, role, project creation, disable, reset, delete). */
export function UsersSection() {
  const qc = useQueryClient();
  const me = useAuth()?.me.user.username;
  const { data: users = [], error } = useQuery({ queryKey: usersKey, queryFn: api.listUsers });
  const [draft, setDraft] = useState({ name: "", username: "", password: randomPassword(), role: "member" as const, canCreateProjects: false });
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const parsed = CreateUserBodySchema.safeParse(draft);
  const refresh = () => qc.invalidateQueries({ queryKey: usersKey });
  const run = async (fn: () => Promise<unknown>) => {
    setFailure(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setFailure((e as Error).message);
    }
  };

  const add = () =>
    run(async () => {
      if (!parsed.success) return;
      await api.createUser(parsed.data);
      setIssued({ username: parsed.data.username, password: parsed.data.password });
      setDraft({ name: "", username: "", password: randomPassword(), role: "member", canCreateProjects: false });
      setUsernameTouched(false);
    });
  const reset = (u: AccountView) =>
    run(async () => {
      const password = randomPassword();
      await api.updateUser(u.username, { password });
      setIssued({ username: u.username, password });
    });

  return (
    <div className="users-settings">
      {issued && (
        <section className="agent-created" role="status">
          <strong>Temporary password for @{issued.username}</strong> — give it to them: they will choose their own at the first sign-in.
          <CopyField label="Password" value={issued.password} />
          <button className="link small" onClick={() => setIssued(null)}>
            Done
          </button>
        </section>
      )}
      <h3 className="settings-section">Add a user</h3>
      <div className="agent-form">
        <label className="field">
          <span>Name</span>
          <input
            value={draft.name}
            placeholder="Mario Rossi"
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value, username: usernameTouched ? d.username : suggestUsername(e.target.value) }))}
          />
        </label>
        <label className="field">
          <span>Username</span>
          <input
            value={draft.username}
            placeholder="mariorossi"
            onChange={(e) => {
              setUsernameTouched(true);
              setDraft((d) => ({ ...d, username: e.target.value.trim() }));
            }}
          />
        </label>
        <label className="field">
          <span>Temporary password</span>
          <input value={draft.password} onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))} />
        </label>
        <label className="check small">
          <input type="checkbox" checked={draft.canCreateProjects} onChange={(e) => setDraft((d) => ({ ...d, canCreateProjects: e.target.checked }))} /> may create projects
        </label>
        <button className="primary" disabled={!parsed.success} onClick={add}>
          Add
        </button>
      </div>
      {!parsed.success && draft.username && <p className="field-error">{parsed.error.issues[0]?.message}</p>}
      {failure && <p className="render-error">{failure}</p>}

      <h3 className="settings-section">Users</h3>
      {error ? (
        <p className="render-error">{(error as Error).message}</p>
      ) : (
        <table className="settings-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>May create projects</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.username === me;
              return (
                <tr key={u.username} className={u.disabled ? "muted" : ""}>
                  <td>
                    <strong>{u.name}</strong> <span className="muted">@{u.username}</span>
                  </td>
                  <td>
                    <select value={u.role} disabled={self} aria-label={`Role of ${u.username}`} onChange={(e) => run(() => api.updateUser(u.username, { role: e.target.value as AccountView["role"] }))}>
                      <option value="member">member</option>
                      <option value="owner">owner</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${u.username} may create projects`}
                      checked={u.canCreateProjects}
                      disabled={u.role === "owner"}
                      onChange={(e) => run(() => api.updateUser(u.username, { canCreateProjects: e.target.checked }))}
                    />
                  </td>
                  <td>{u.disabled ? "disabled" : u.mustChangePassword ? "temporary password" : "active"}</td>
                  <td className="settings-actions">
                    {!self && (
                      <button className="link small" onClick={() => run(() => api.updateUser(u.username, { disabled: !u.disabled }))}>
                        {u.disabled ? "Enable" : "Disable"}
                      </button>
                    )}
                    <button className="link small" onClick={() => reset(u)}>
                      Reset password
                    </button>
                    {!self && (
                      <button
                        className="link danger small"
                        onClick={() => window.confirm(`Delete @${u.username}? Their agents are revoked; their comments stay.`) && run(() => api.deleteUser(u.username))}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Owner: who may open each project / template, in reading (with comments) or writing. */
export function AccessSection() {
  const qc = useQueryClient();
  const { data: users = [] } = useQuery({ queryKey: usersKey, queryFn: api.listUsers });
  const { data: projects = [], error } = useQuery({ queryKey: accessKey, queryFn: api.listAccess });
  const [failure, setFailure] = useState<string | null>(null);
  const members = users.filter((u) => u.role !== "owner");
  const set = async (kind: NotebookKind, id: string, username: string, level: AccessLevel | null) => {
    setFailure(null);
    try {
      await api.setAccess(kind, id, { [username]: level });
      await qc.invalidateQueries({ queryKey: accessKey });
    } catch (e) {
      setFailure((e as Error).message);
    }
  };
  if (error) return <p className="render-error">{(error as Error).message}</p>;
  return (
    <div className="access-settings">
      <p className="muted small">
        Owners open everything. Others see only the projects and templates listed for them: <strong>read</strong> to read and comment,{" "}
        <strong>write</strong> to also edit. Their agents get the same rights.
      </p>
      {members.length === 0 ? (
        <p className="muted small">No other users yet (Users tab).</p>
      ) : (
        <div className="settings-table-wrap">
          <table className="settings-table access-table">
            <thead>
              <tr>
                <th>Project / template</th>
                {members.map((u) => (
                  <th key={u.username} title={`@${u.username}`}>
                    {u.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={`${p.kind}/${p.id}`}>
                  <td>
                    {p.name} <span className="muted small">{p.kind === "templates" ? "template" : ""}</span>
                  </td>
                  {members.map((u) => (
                    <td key={u.username}>
                      <select
                        aria-label={`Access of ${u.username} to ${p.name}`}
                        value={p.access[u.username] ?? ""}
                        onChange={(e) => set(p.kind, p.id, u.username, (e.target.value || null) as AccessLevel | null)}
                      >
                        <option value="">—</option>
                        <option value="read">read</option>
                        <option value="write">write</option>
                      </select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {failure && <p className="render-error">{failure}</p>}
    </div>
  );
}

/** Owner: every locked sub-block, to release locks someone forgot. */
export function LocksSection() {
  const qc = useQueryClient();
  const { data: locks = [], error } = useQuery({ queryKey: locksKey, queryFn: api.listAllLocks });
  const [failure, setFailure] = useState<string | null>(null);
  if (error) return <p className="render-error">{(error as Error).message}</p>;
  return (
    <div className="locks-settings">
      <p className="muted small">A locked sub-block can be changed only by whoever took it. Release locks that were forgotten.</p>
      {locks.length === 0 ? (
        <p className="muted small">No locked sub-blocks.</p>
      ) : (
        <table className="settings-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Held by</th>
              <th>Since</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {locks.map((l) => (
              <tr key={`${l.projectId}/${l.subBlockId}`}>
                <td>
                  <a href={`#/${l.kind}/${l.projectId}/s/${l.blockId}/b/${l.subBlockId}`}>{l.projectName}</a>
                </td>
                <td>
                  {l.holder.name}
                  {l.holder.onBehalfOf && <span className="muted small"> · for {l.holder.onBehalfOf.name}</span>}
                </td>
                <td>{new Date(l.since).toLocaleString()}</td>
                <td>
                  <button
                    className="link small"
                    onClick={async () => {
                      setFailure(null);
                      try {
                        await api.unlockIn(l.kind, l.projectId, l.blockId, l.subBlockId);
                        await qc.invalidateQueries({ queryKey: locksKey });
                      } catch (e) {
                        setFailure((e as Error).message);
                      }
                    }}
                  >
                    Unlock
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {failure && <p className="render-error">{failure}</p>}
    </div>
  );
}
