import { UserProfileSchema, type UserProfile } from "@sourcebook/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { keys, useUser } from "../api/queries";
import { Avatar } from "./Avatar";
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

export function SettingsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const qc = useQueryClient();
  const { data: user } = useUser();
  const [draft, setDraft] = useState<UserProfile>({ name: "", username: "" });
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) return;
    setDraft(user);
    setUsernameTouched(true);
    setError(null);
  }, [open, user]);

  const parsed = UserProfileSchema.safeParse(draft);
  const fieldError = (field: keyof UserProfile) =>
    parsed.success ? null : (parsed.error.issues.find((i) => i.path[0] === field)?.message ?? null);

  const save = async () => {
    if (!parsed.success) return;
    setSaving(true);
    setError(null);
    try {
      qc.setQueryData(keys.user, await api.setUser(parsed.data));
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
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!parsed.success || saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <h3 className="settings-section">Profile</h3>
      <div className="settings-profile">
        <Avatar name={draft.name || "?"} username={draft.username || "?"} size={48} />
        <div className="settings-fields">
          <label className="field">
            <span>Name</span>
            <input
              value={draft.name}
              placeholder="Mario Rossi"
              autoFocus
              onChange={(e) => {
                const name = e.target.value;
                setDraft((d) => ({ name, username: usernameTouched ? d.username : suggestUsername(name) }));
              }}
            />
            {draft.name !== "" && fieldError("name") && <span className="field-error">{fieldError("name")}</span>}
          </label>
          <label className="field">
            <span>Username</span>
            <div className="input-prefix">
              <span aria-hidden="true">@</span>
              <input
                value={draft.username}
                placeholder="mariorossi"
                onChange={(e) => {
                  setUsernameTouched(true);
                  setDraft((d) => ({ ...d, username: e.target.value.trim() }));
                }}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
            </div>
            {draft.username !== "" && fieldError("username") && <span className="field-error">{fieldError("username")}</span>}
          </label>
        </div>
      </div>
      <p className="muted small">Shown as the author of your comments. Saved on this computer, for every project.</p>
      {error && <p className="render-error">{error}</p>}
    </Dialog>
  );
}
