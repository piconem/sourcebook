import { LIGHT_SURFACE, THEMES, themeById, type SurfacePalette, type Theme } from "./themes";

/**
 * Editing surfaces in dark themes: dark like the theme, light only for text (Markdown sub-blocks, for long
 * reading), or light everywhere (text fields, editors and previews).
 */
export type SurfaceMode = "theme" | "text" | "all";
export const SURFACE_MODES: readonly SurfaceMode[] = ["theme", "text", "all"];

/** User preference, stored per browser (not per project). */
export interface AppearancePrefs {
  /** A theme id, or "system" to follow the OS light/dark setting. */
  theme: string;
  /** Applies to dark themes only. */
  surfaces: SurfaceMode;
}

export interface ResolvedAppearance {
  theme: Theme;
  /** Palette of editing surfaces. */
  surface: SurfacePalette;
  /** Palette of text surfaces (Markdown sub-blocks): `surface`, or light in the "text" mode. */
  textSurface: SurfacePalette;
}

const STORAGE_KEY = "sourcebook.appearance";
export const DEFAULT_PREFS: AppearancePrefs = { theme: "system", surfaces: "theme" };

export function loadPrefs(): AppearancePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (raw && typeof raw.theme === "string") {
      // Before the three modes: a "lightSurfaces" checkbox (true = light everywhere).
      const surfaces: SurfaceMode = SURFACE_MODES.includes(raw.surfaces) ? raw.surfaces : raw.lightSurfaces ? "all" : "theme";
      return { theme: raw.theme, surfaces };
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
  const dark = theme.scheme === "dark";
  const surface = dark && prefs.surfaces === "all" ? LIGHT_SURFACE : theme.surface;
  const textSurface = dark && prefs.surfaces === "text" ? LIGHT_SURFACE : surface;
  return { theme, surface, textSurface };
}

/** Writes the resolved palette as CSS custom properties on <html>. */
export function applyAppearance({ theme, surface, textSurface }: ResolvedAppearance, root = document.documentElement) {
  for (const [k, v] of Object.entries(theme.ui)) root.style.setProperty(`--${k}`, v);
  for (const [k, v] of Object.entries(surface.colors)) root.style.setProperty(`--s-${k}`, v);
  for (const [k, v] of Object.entries(surface.syntax)) root.style.setProperty(`--syn-${k}`, v);
  root.style.setProperty("--s-scheme", surface.scheme);
  // Text surfaces (`.surface-text` in styles.css) take these in place of --s-* / --syn-*.
  for (const [k, v] of Object.entries(textSurface.colors)) root.style.setProperty(`--t-${k}`, v);
  for (const [k, v] of Object.entries(textSurface.syntax)) root.style.setProperty(`--tsyn-${k}`, v);
  root.style.setProperty("--t-scheme", textSurface.scheme);
  root.style.colorScheme = theme.scheme;
  root.dataset.theme = theme.id;
  root.dataset.scheme = theme.scheme;
  root.dataset.surfaceScheme = surface.scheme;
}
