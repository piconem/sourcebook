import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyAppearance,
  loadPrefs,
  resolveAppearance,
  savePrefs,
  systemPrefersDark,
  type AppearancePrefs,
  type ResolvedAppearance,
} from "./appearance";
import type { Scheme } from "./themes";

interface AppearanceValue extends ResolvedAppearance {
  prefs: AppearancePrefs;
  setPrefs(p: AppearancePrefs): void;
  /** Scheme of editing surfaces: third-party renderers (Excalidraw, mermaid) follow this. */
  surfaceScheme: Scheme;
}

const Ctx = createContext<AppearanceValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState(loadPrefs);
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setPrefersDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved = useMemo(() => resolveAppearance(prefs, prefersDark), [prefs, prefersDark]);
  useEffect(() => applyAppearance(resolved), [resolved]);

  const value = useMemo<AppearanceValue>(
    () => ({
      ...resolved,
      prefs,
      surfaceScheme: resolved.surface.scheme,
      setPrefs: (p) => {
        savePrefs(p);
        setPrefsState(p);
      },
    }),
    [resolved, prefs],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppearance(): AppearanceValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppearance must be used inside <AppearanceProvider>");
  return v;
}
