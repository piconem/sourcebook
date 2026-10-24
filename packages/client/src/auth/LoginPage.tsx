import { APP_NAME, APP_VERSION, PasswordSchema, type Me } from "@sourcebook/shared";
import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import logo from "../assets/logo.png";

function AuthCard(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img className="auth-logo" src={logo} alt="" aria-hidden="true" />
          <span>{APP_NAME}</span>
        </div>
        <h1>{props.title}</h1>
        {props.children}
      </div>
      <p className="muted small auth-version">
        {APP_NAME} {APP_VERSION}
      </p>
    </div>
  );
}

export function LoginPage({ onSignedIn }: { onSignedIn(me: Me): void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.login(username.trim(), password));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Sign in">
      <form className="auth-form" onSubmit={submit}>
        <label>
          Username
          <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="render-error">{error}</p>}
        <button className="primary" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="muted small">Accounts are created by the owner of this Sourcebook. First start: the owner's password is in the server log.</p>
      </form>
    </AuthCard>
  );
}

/** Password form (forced at the first sign-in, or from Settings → Account). */
export function PasswordForm({ onChanged, submitLabel = "Change password" }: { onChanged(me: Me): void; submitLabel?: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invalid = PasswordSchema.safeParse(next).error?.issues[0]?.message;
  const mismatch = again && next !== again ? "The two passwords differ" : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.changePassword(current, next));
      setCurrent("");
      setNext("");
      setAgain("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        Current password
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label>
        New password
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        {next && invalid && <span className="field-error">{invalid}</span>}
      </label>
      <label>
        Repeat the new password
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        {mismatch && <span className="field-error">{mismatch}</span>}
      </label>
      {error && <p className="render-error">{error}</p>}
      <button className="primary" type="submit" disabled={busy || !current || !!invalid || next !== again}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

export function ChangePasswordPage({ me, onChanged }: { me: Me; onChanged(me: Me): void }) {
  return (
    <AuthCard title="Choose your password">
      <p className="small">
        Welcome, <strong>{me.user.name}</strong> (@{me.user.username}). Replace the temporary password before you continue.
      </p>
      <PasswordForm onChanged={onChanged} submitLabel="Save and continue" />
    </AuthCard>
  );
}
