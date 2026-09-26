import { expect, it } from "vitest";
import { THEMES } from "./themes";

/** WCAG 2 contrast: every theme must keep text, accents and syntax colors readable (AA). */
const lum = (hex: string) => {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const cr = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
it("all themes meet WCAG AA contrast", () => {
  const rows: string[] = [];
  for (const t of THEMES) {
    const u = t.ui, s = t.surface;
    const checks: [string, number, number][] = [
      ["ui text/panel", cr(u.text, u.panel), 4.5], ["ui muted/panel", cr(u.muted, u.panel), 4.5], ["ui muted/bg", cr(u.muted, u.bg), 4.5],
      ["accent/panel", cr(u.accent, u.panel), 3], ["on-accent/accent", cr(u["on-accent"], u.accent), 4.5], ["danger/panel", cr(u.danger, u.panel), 4.5],
      ["objective text", cr(u["objective-text"], u["objective-bg"]), 4.5],
      ["s text/field", cr(s.colors.text, s.colors.field), 4.5], ["s muted/bg", cr(s.colors.muted, s.colors.bg), 4.5],
      ...Object.entries(s.syntax).map(([k, v]) => [`syn ${k}/field`, cr(v, s.colors.field), 4.5] as [string, number, number]),
      ...Object.entries(s.syntax).map(([k, v]) => [`syn ${k}/code-bg`, cr(v, s.colors["code-bg"]), 4.5] as [string, number, number]),
    ];
    for (const [n, v, min] of checks) if (v < min) rows.push(`${t.id}: ${n} ${v.toFixed(2)} < ${min}`);
  }
  expect(rows).toEqual([]);
});
