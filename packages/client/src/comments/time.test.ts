import { describe, expect, it } from "vitest";
import { relativeTime } from "./time";

const now = Date.parse("2026-09-26T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("relativeTime", () => {
  it.each([
    [10_000, "just now"],
    [5 * 60_000, "5 min ago"],
    [3 * 3_600_000, "3 h ago"],
  ])("%i ms → %s", (ms, text) => expect(relativeTime(ago(ms), now)).toBe(text));

  it("uses yesterday and dates for older comments", () => {
    expect(relativeTime(ago(30 * 3_600_000), now)).toMatch(/^yesterday /);
    expect(relativeTime("2026-03-02T10:00:00Z", now)).not.toMatch(/ago|yesterday/);
    expect(relativeTime("2024-03-02T10:00:00Z", now)).toMatch(/2024/);
    expect(relativeTime("not a date", now)).toBe("");
  });
});
