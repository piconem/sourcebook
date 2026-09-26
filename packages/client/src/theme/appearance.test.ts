import { describe, expect, it } from "vitest";
import { resolveAppearance } from "./appearance";
import { LIGHT_SURFACE, THEMES } from "./themes";

describe("appearance", () => {
  it("follows the system scheme", () => {
    expect(resolveAppearance({ theme: "system", lightSurfaces: false }, true).theme.id).toBe("dark");
    expect(resolveAppearance({ theme: "system", lightSurfaces: false }, false).theme.id).toBe("light");
  });

  it("keeps surfaces light in dark themes on request", () => {
    const r = resolveAppearance({ theme: "midnight", lightSurfaces: true });
    expect(r.theme.id).toBe("midnight");
    expect(r.surface).toBe(LIGHT_SURFACE);
    expect(resolveAppearance({ theme: "sepia", lightSurfaces: true }).surface.scheme).toBe("light");
    expect(resolveAppearance({ theme: "sepia", lightSurfaces: true }).surface).not.toBe(LIGHT_SURFACE);
  });

  it("falls back to the first theme for unknown ids", () => {
    expect(resolveAppearance({ theme: "nope", lightSurfaces: false }).theme).toBe(THEMES[0]);
  });

  it("every theme defines the same tokens", () => {
    const keys = (t: (typeof THEMES)[number]) =>
      [Object.keys(t.ui), Object.keys(t.surface.colors), Object.keys(t.surface.syntax)].map((k) => k.sort().join());
    for (const t of THEMES) expect(keys(t)).toEqual(keys(THEMES[0]));
  });
});
