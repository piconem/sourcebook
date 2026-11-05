// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { loadPrefs, resolveAppearance } from "./appearance";
import { LIGHT_SURFACE, THEMES } from "./themes";

describe("appearance", () => {
  it("follows the system scheme", () => {
    expect(resolveAppearance({ theme: "system", surfaces: "theme" }, true).theme.id).toBe("dark");
    expect(resolveAppearance({ theme: "system", surfaces: "theme" }, false).theme.id).toBe("light");
  });

  it("keeps surfaces light in dark themes on request", () => {
    const r = resolveAppearance({ theme: "midnight", surfaces: "all" });
    expect(r.theme.id).toBe("midnight");
    expect(r.surface).toBe(LIGHT_SURFACE);
    expect(resolveAppearance({ theme: "sepia", surfaces: "all" }).surface.scheme).toBe("light");
    expect(resolveAppearance({ theme: "sepia", surfaces: "all" }).surface).not.toBe(LIGHT_SURFACE);
  });

  it("keeps only text (Markdown) surfaces light in dark themes with the text mode", () => {
    const r = resolveAppearance({ theme: "dark", surfaces: "text" });
    expect(r.surface).toBe(THEMES.find((t) => t.id === "dark")!.surface);
    expect(r.textSurface).toBe(LIGHT_SURFACE);
    // Light themes, and the other modes: text surfaces are the same as the others.
    expect(resolveAppearance({ theme: "sepia", surfaces: "text" }).textSurface).toBe(resolveAppearance({ theme: "sepia", surfaces: "text" }).surface);
    expect(resolveAppearance({ theme: "dark", surfaces: "theme" }).textSurface.scheme).toBe("dark");
    expect(resolveAppearance({ theme: "midnight", surfaces: "all" }).textSurface).toBe(LIGHT_SURFACE);
  });

  it("reads the former checkbox preference", () => {
    localStorage.setItem("sourcebook.appearance", JSON.stringify({ theme: "dark", lightSurfaces: true }));
    expect(loadPrefs()).toEqual({ theme: "dark", surfaces: "all" });
    localStorage.setItem("sourcebook.appearance", JSON.stringify({ theme: "dark", lightSurfaces: false }));
    expect(loadPrefs()).toEqual({ theme: "dark", surfaces: "theme" });
    localStorage.setItem("sourcebook.appearance", JSON.stringify({ theme: "midnight", surfaces: "text" }));
    expect(loadPrefs()).toEqual({ theme: "midnight", surfaces: "text" });
    localStorage.clear();
  });

  it("falls back to the first theme for unknown ids", () => {
    expect(resolveAppearance({ theme: "nope", surfaces: "theme" }).theme).toBe(THEMES[0]);
  });

  it("every theme defines the same tokens", () => {
    const keys = (t: (typeof THEMES)[number]) =>
      [Object.keys(t.ui), Object.keys(t.surface.colors), Object.keys(t.surface.syntax)].map((k) => k.sort().join());
    for (const t of THEMES) expect(keys(t)).toEqual(keys(THEMES[0]));
  });
});
