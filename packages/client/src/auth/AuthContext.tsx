import type { Me } from "@sourcebook/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { AUTH_CHANGED, ApiError, api } from "../api/client";
import { ChangePasswordPage, LoginPage } from "./LoginPage";

export const meKey = ["me"] as const;

interface AuthValue {
  me: Me;
  /** Signs out and shows the sign-in page. */
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** The signed-in principal; null outside the gate (tests render parts of the app without it). */
export const useAuth = () => useContext(AuthContext);

/** Whether the signed-in user is the owner of this Sourcebook (true without a gate: single-user rendering). */
export const useIsOwner = () => {
  const auth = useAuth();
  return !auth || auth.me.user.role === "owner";
};

/**
 * Shows the sign-in page until there is a session, then the forced password change if needed, then the app.
 * Any API call answered 401 (signed out elsewhere, disabled, password reset) brings the sign-in page back.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: Infinity,
  });
  useEffect(() => {
    const recheck = () => void qc.invalidateQueries({ queryKey: meKey });
    window.addEventListener(AUTH_CHANGED, recheck);
    return () => window.removeEventListener(AUTH_CHANGED, recheck);
  }, [qc]);

  if (me.isLoading) return <p className="muted auth-loading">Loading…</p>;
  if (me.error) return <p className="render-error auth-loading">Cannot reach the Sourcebook server: {(me.error as Error).message}</p>;
  // Another account may have been signed in before: drop everything cached (but the session itself).
  const dropCache = () => qc.removeQueries({ predicate: (q) => q.queryKey[0] !== meKey[0] });
  const signedIn = (next: Me) => {
    dropCache();
    qc.setQueryData(meKey, next);
  };
  if (!me.data) return <LoginPage onSignedIn={signedIn} />;
  if (me.data.user.mustChangePassword) return <ChangePasswordPage me={me.data} onChanged={signedIn} />;
  const value: AuthValue = {
    me: me.data,
    async signOut() {
      await api.logout().catch(() => undefined);
      dropCache();
      qc.setQueryData(meKey, null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
