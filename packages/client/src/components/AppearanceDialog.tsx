import { useAppearance } from "../theme/AppearanceContext";
import type { SurfaceMode } from "../theme/appearance";
import { LIGHT_SURFACE, THEMES, themeById, type SurfacePalette, type Theme } from "../theme/themes";
import { Dialog } from "./Dialog";

/** Mini preview of a theme: chrome color, accent, and an editing surface with syntax lines. */
function Swatch({ theme, surface }: { theme: Theme; surface: SurfacePalette }) {
  return (
    <div className="theme-swatch" aria-hidden="true">
      <span style={{ background: theme.ui.panel, flex: 0.7 }} />
      <span style={{ background: theme.ui.accent, flex: 0.15 }} />
      <span className="sw-surface" style={{ background: surface.colors.bg }}>
        <span className="sw-line" style={{ background: surface.syntax.keyword, width: "45%" }} />
        <span className="sw-line" style={{ background: surface.colors.text, width: "80%" }} />
        <span className="sw-line" style={{ background: surface.syntax.string, width: "60%" }} />
      </span>
    </div>
  );
}

export function AppearanceDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { prefs, setPrefs, theme } = useAppearance();
  const surfaceFor = (t: Theme) => (t.scheme === "dark" && prefs.surfaces === "all" ? LIGHT_SURFACE : t.surface);
  const modes: { mode: SurfaceMode; label: string; hint: string }[] = [
    { mode: "theme", label: "Dark, like the theme", hint: "every block follows the theme" },
    { mode: "text", label: "Light text", hint: "Markdown blocks light for reading; code, data and diagrams stay dark" },
    { mode: "all", label: "Light blocks", hint: "text fields, editors and previews all light" },
  ];
  const system = { light: themeById("light")!, dark: themeById("dark")! };

  return (
    <Dialog open={open} title="Appearance" onClose={onClose} actions={<button onClick={onClose}>Done</button>}>
      <p className="muted small">Saved in this browser; each person can choose their own.</p>
      <div className="theme-grid" role="radiogroup" aria-label="Theme">
        <button
          type="button"
          role="radio"
          aria-checked={prefs.theme === "system"}
          className={`theme-card${prefs.theme === "system" ? " selected" : ""}`}
          onClick={() => setPrefs({ ...prefs, theme: "system" })}
        >
          <div className="theme-swatch" aria-hidden="true">
            <span style={{ background: system.light.ui.panel }} />
            <span style={{ background: system.dark.ui.panel }} />
          </div>
          <strong>System</strong>
          <span className="muted">Follows your OS ({theme.scheme === "dark" ? "dark" : "light"} now)</span>
        </button>
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={prefs.theme === t.id}
            className={`theme-card${prefs.theme === t.id ? " selected" : ""}`}
            onClick={() => setPrefs({ ...prefs, theme: t.id })}
          >
            <Swatch theme={t} surface={surfaceFor(t)} />
            <strong>{t.label}</strong>
            <span className="muted">{t.scheme === "dark" ? "Dark" : "Light"}</span>
          </button>
        ))}
      </div>
      <fieldset className={`surface-modes${theme.scheme === "dark" ? "" : " disabled"}`}>
        <legend>Blocks in dark themes</legend>
        {modes.map(({ mode, label, hint }) => (
          <label key={mode} className="check">
            <input type="radio" name="surface-mode" checked={prefs.surfaces === mode} onChange={() => setPrefs({ ...prefs, surfaces: mode })} />
            <span>
              {label} <span className="muted small">— {hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {theme.scheme !== "dark" && <p className="muted small">Applies when a dark theme is active.</p>}
    </Dialog>
  );
}
