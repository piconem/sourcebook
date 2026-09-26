/**
 * Theme registry. A theme is data: CSS custom-property values for the app chrome (`ui`) and for
 * editing surfaces (`surface`: text fields, editors, previews, syntax colors). Adding a theme means
 * adding an entry here; components only reference the variables.
 */
export type Scheme = "light" | "dark";

export type UiToken =
  | "bg" | "panel" | "text" | "muted" | "border" | "border-strong" | "hover" | "subtle" | "code-bg"
  | "accent" | "accent-soft" | "on-accent" | "danger" | "shadow" | "backdrop"
  | "objective-bg" | "objective-border" | "objective-text";

export type SurfaceToken =
  | "bg" | "field" | "text" | "muted" | "border" | "border-strong" | "hover" | "subtle" | "code-bg"
  | "accent-soft" | "objective-bg" | "objective-border" | "objective-text" | "selection" | "active-line";

export type SyntaxToken =
  | "keyword" | "string" | "number" | "comment" | "function" | "type" | "variable" | "property"
  | "meta" | "tag" | "attr" | "operator";

export interface SurfacePalette {
  scheme: Scheme;
  colors: Record<SurfaceToken, string>;
  syntax: Record<SyntaxToken, string>;
}

export interface Theme {
  id: string;
  label: string;
  scheme: Scheme;
  ui: Record<UiToken, string>;
  surface: SurfacePalette;
}

const lightSurface: SurfacePalette = {
  scheme: "light",
  colors: {
    bg: "#ffffff", field: "#fbfbfa", text: "#1f2328", muted: "#6b7280", border: "#e5e7eb",
    "border-strong": "#c7cbd1", hover: "#f1f2f4", subtle: "#f6f7f9", "code-bg": "#f3f4f6",
    "accent-soft": "#e8efff", "objective-bg": "#fbf8ef", "objective-border": "#d9b44a",
    "objective-text": "#8a6d1d", selection: "#b6d3ff", "active-line": "#f5f7fa",
  },
  syntax: {
    keyword: "#cf222e", string: "#0a3069", number: "#0550ae", comment: "#5f6873", function: "#8250df",
    type: "#953800", variable: "#1f2328", property: "#0550ae", meta: "#5f6873", tag: "#116329",
    attr: "#0550ae", operator: "#cf222e",
  },
};

export const LIGHT_SURFACE = lightSurface;

export const THEMES: Theme[] = [
  {
    id: "light",
    label: "Light",
    scheme: "light",
    ui: {
      bg: "#f7f7f5", panel: "#ffffff", text: "#1f2328", muted: "#6b7280", border: "#e5e7eb",
      "border-strong": "#c7cbd1", hover: "#f1f2f4", subtle: "#f6f7f9", "code-bg": "#f3f4f6",
      accent: "#2563eb", "accent-soft": "#e8efff", "on-accent": "#ffffff", danger: "#b42318",
      shadow: "rgba(0, 0, 0, .18)", backdrop: "rgba(15, 23, 42, .4)",
      "objective-bg": "#fbf8ef", "objective-border": "#d9b44a", "objective-text": "#8a6d1d",
    },
    surface: lightSurface,
  },
  {
    id: "dark",
    label: "Dark",
    scheme: "dark",
    ui: {
      bg: "#0d1117", panel: "#161b22", text: "#e6edf3", muted: "#8b949e", border: "#30363d",
      "border-strong": "#484f58", hover: "#21262d", subtle: "#1c2128", "code-bg": "#1f242c",
      accent: "#4c8dff", "accent-soft": "#1f2d4a", "on-accent": "#0d1117", danger: "#f85149",
      shadow: "rgba(0, 0, 0, .5)", backdrop: "rgba(1, 4, 9, .6)",
      "objective-bg": "#2a2410", "objective-border": "#bb9a3a", "objective-text": "#e3c567",
    },
    surface: {
      scheme: "dark",
      colors: {
        bg: "#161b22", field: "#0d1117", text: "#e6edf3", muted: "#8b949e", border: "#30363d",
        "border-strong": "#484f58", hover: "#21262d", subtle: "#1c2128", "code-bg": "#1f242c",
        "accent-soft": "#1f2d4a", "objective-bg": "#2a2410", "objective-border": "#bb9a3a",
        "objective-text": "#e3c567", selection: "#264f78", "active-line": "#1c2128",
      },
      syntax: {
        keyword: "#ff7b72", string: "#a5d6ff", number: "#79c0ff", comment: "#8b949e", function: "#d2a8ff",
        type: "#ffa657", variable: "#e6edf3", property: "#79c0ff", meta: "#8b949e", tag: "#7ee787",
        attr: "#79c0ff", operator: "#ff7b72",
      },
    },
  },
  {
    id: "sepia",
    label: "Sepia",
    scheme: "light",
    ui: {
      bg: "#f4ecd8", panel: "#fbf6e9", text: "#3b3024", muted: "#6f604b", border: "#e3d6ba",
      "border-strong": "#cbb994", hover: "#efe4c9", subtle: "#f1e7cf", "code-bg": "#efe4c9",
      accent: "#9a5b13", "accent-soft": "#f1dfc0", "on-accent": "#ffffff", danger: "#a4271b",
      shadow: "rgba(59, 48, 36, .2)", backdrop: "rgba(59, 48, 36, .35)",
      "objective-bg": "#f6ecd0", "objective-border": "#c79a3a", "objective-text": "#7a5a12",
    },
    surface: {
      scheme: "light",
      colors: {
        bg: "#fdf9ef", field: "#fbf5e6", text: "#3b3024", muted: "#6f604b", border: "#e3d6ba",
        "border-strong": "#cbb994", hover: "#f3ead3", subtle: "#f6eedb", "code-bg": "#f3ead3",
        "accent-soft": "#f1dfc0", "objective-bg": "#f6ecd0", "objective-border": "#c79a3a",
        "objective-text": "#7a5a12", selection: "#ecd9ae", "active-line": "#f6eedb",
      },
      syntax: {
        keyword: "#a3341f", string: "#4b6b1f", number: "#8a4b08", comment: "#6f604b", function: "#6b3f8f",
        type: "#8a5a00", variable: "#3b3024", property: "#2f5d7a", meta: "#6f604b", tag: "#4b6b1f",
        attr: "#2f5d7a", operator: "#a3341f",
      },
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    scheme: "dark",
    ui: {
      bg: "#242933", panel: "#2e3440", text: "#eceff4", muted: "#a3adbf", border: "#3b4252",
      "border-strong": "#4c566a", hover: "#3b4252", subtle: "#333a47", "code-bg": "#272c36",
      accent: "#88c0d0", "accent-soft": "#34495a", "on-accent": "#1d2129", danger: "#ec8a93",
      shadow: "rgba(0, 0, 0, .45)", backdrop: "rgba(20, 24, 31, .6)",
      "objective-bg": "#3a3628", "objective-border": "#ebcb8b", "objective-text": "#ebcb8b",
    },
    surface: {
      scheme: "dark",
      colors: {
        bg: "#2e3440", field: "#292e39", text: "#eceff4", muted: "#a3adbf", border: "#3b4252",
        "border-strong": "#4c566a", hover: "#3b4252", subtle: "#333a47", "code-bg": "#272c36",
        "accent-soft": "#34495a", "objective-bg": "#3a3628", "objective-border": "#ebcb8b",
        "objective-text": "#ebcb8b", selection: "#434c5e", "active-line": "#333a47",
      },
      syntax: {
        keyword: "#81a1c1", string: "#a3be8c", number: "#b48ead", comment: "#9aa5b8", function: "#88c0d0",
        type: "#8fbcbb", variable: "#d8dee9", property: "#8fbcbb", meta: "#9aa5b8", tag: "#81a1c1",
        attr: "#8fbcbb", operator: "#81a1c1",
      },
    },
  },
];

export const themeById = (id: string) => THEMES.find((t) => t.id === id);
