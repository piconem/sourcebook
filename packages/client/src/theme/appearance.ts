import { LIGHT_SURFACE, THEMES, themeById, type SurfacePalette, type Theme } from "./themes";

/** User preference, stored per browser (not per project). */
export interface AppearancePrefs {
  /** A theme id, or "system" to follow the OS light/dark setting. */
  theme: string;
  /** In dark themes, keep text fields, editors and previews light. */
  lightSurfaces: boolean;
}

export interface ResolvedAppearance {
  theme: Theme;
  surface: SurfacePalette;
}

const STORAGE_KEY = "sourcebook.appearance";
export const DEFAULT_PREFS: AppearancePrefs = { theme: "system", lightSurfaces: false };

export function loadPrefs(): AppearancePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (raw && typeof raw.theme === "string") {
      return { theme: raw.theme, lightSurfaces: !!raw.lightSurfaces };
    }
  } catch {
    // Storage unavailable or corrupt: fall back to defaults.
  }
  return DEFAULT_PREFS;
}

export function savePrefs(prefs: AppearancePrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Non-persistent session; the choice still applies until reload.
  }
}

export const systemPrefersDark = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

export function resolveAppearance(prefs: AppearancePrefs, prefersDark = systemPrefersDark()): ResolvedAppearance {
  const theme =
    (prefs.theme === "system" ? themeById(prefersDark ? "dark" : "light") : themeById(prefs.theme)) ?? THEMES[0];
  const surface = theme.scheme === "dark" && prefs.lightSurfaces ? LIGHT_SURFACE : theme.surface;
  return { theme, surface };
}

/** Writes the resolved palette as CSS custom properties on <html>. */
export function applyAppearance({ theme, surface }: ResolvedAppearance, root = document.documentElement) {
  for (const [k, v] of Object.entries(theme.ui)) root.style.setProperty(`--${k}`, v);
  for (const [k, v] of Object.entries(surface.colors)) root.style.setProperty(`--s-${k}`, v);
  for (const [k, v] of Object.entries(surface.syntax)) root.style.setProperty(`--syn-${k}`, v);
  root.style.setProperty("--s-scheme", surface.scheme);
  root.style.colorScheme = theme.scheme;
  root.dataset.theme = theme.id;
  root.dataset.scheme = theme.scheme;
  root.dataset.surfaceScheme = surface.scheme;
}
