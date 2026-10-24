import { UserProfileSchema } from "@sourcebook/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { keys, useUser } from "../api/queries";
import { Avatar } from "./Avatar";
import { McpSettingsSection } from "../settings/McpSettingsSection";
import { AgentsSection } from "../settings/AgentsSection";
import { AccessSection, LocksSection, UsersSection } from "../settings/UsersSection";
import { meKey, useAuth, useIsOwner } from "../auth/AuthContext";
import { PasswordForm } from "../auth/LoginPage";
import { AvatarPicker } from "./AvatarPicker";
import { Dialog } from "./Dialog";

/** "Mario Rossi" → "mariorossi" */
export const suggestUsername = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .slice(0, 39);

export type SettingsTab = "profile" | "agents" | "mcp" | "users" | "access" | "locks";

const TABS: { id: SettingsTab; label: string; owner?: boolean }[] = [
  { id: "profile", label: "Account" },
  { id: "agents", label: "My agents" },
  { id: "mcp", label: "AI assistant (MCP)" },
  { id: "users", label: "Users", owner: true },
  { id: "access", label: "Project access", owner: true },
  { id: "locks", label: "Locks", owner: true },
];

export function SettingsDialog({ open, onClose, initialTab = "profile" }: { open: boolean; onClose(): void; initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);
  const qc = useQueryClient();
  const auth = useAuth();
  const owner = useIsOwner();
  const { data: user } = useUser();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setName(user.name);
    setError(null);
    setPasswordSaved(false);
  }, [open, user]);

  const parsed = UserProfileSchema.safeParse({ name, username: user?.username ?? "" });
  const nameError = parsed.success ? null : (parsed.error.issues.find((i) => i.path[0] === "name")?.message ?? null);

  const save = async () => {
    if (!parsed.success) return;
    setSaving(true);
    setError(null);
    try {
      qc.setQueryData(keys.user, await api.setUser(parsed.data));
      if (auth) void qc.invalidateQueries({ queryKey: meKey });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Settings"
      wide={tab !== "profile"}
      onClose={onClose}
      actions={
        tab === "profile" ? (
          <>
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!parsed.success || saving || name === user?.name} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        ) : (
          <button className="primary" onClick={onClose}>
            Done
          </button>
        )
      }
    >
      <div className="tabs" role="tablist">
        {TABS.filter((t) => !t.owner || (owner && auth)).map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "mcp" ? (
        <McpSettingsSection />
      ) : tab === "agents" ? (
        <AgentsSection />
      ) : tab === "users" ? (
        <UsersSection />
      ) : tab === "access" ? (
        <AccessSection />
      ) : tab === "locks" ? (
        <LocksSection />
      ) : (
        <>
          <h3 className="settings-section">Profile</h3>
          <div className="settings-profile">
            {user ? <AvatarPicker id={user.username} name={name || user.name} size={56} /> : <Avatar name="?" username="?" size={56} />}
            <div className="settings-fields">
              <label className="field">
                <span>Name</span>
                <input value={name} placeholder="Mario Rossi" autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
                {name !== "" && nameError && <span className="field-error">{nameError}</span>}
              </label>
              <div className="field">
                <span>Username</span>
                <span className="settings-username">@{user?.username}</span>
              </div>
            </div>
          </div>
          <p className="muted small">
            Shown as the author of your comments; your agents sign as “agent · for {name || "you"}”.
            {auth && ` ${auth.me.user.role === "owner" ? "Owner of this Sourcebook." : auth.me.user.canCreateProjects ? "You may create projects." : ""}`}
          </p>
          {error && <p className="render-error">{error}</p>}
          {auth && (
            <>
              <h3 className="settings-section">Password</h3>
              {passwordSaved && <p className="small">Password changed.</p>}
              <PasswordForm onChanged={(me) => (qc.setQueryData(meKey, me), setPasswordSaved(true))} />
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
