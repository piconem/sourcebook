import { describe, expect, it } from "vitest";
import { parseProject, parseRef } from "../src/refs.js";

describe("references", () => {
  it.each([
    ["§2.1", { kind: "outline", number: "2.1" }],
    ["2.1", { kind: "outline", number: "2.1" }],
    ["§2.1#3", { kind: "outline", number: "2.1", subIndex: 3 }],
    ["§2.1 #3 : L10-14", { kind: "outline", number: "2.1", subIndex: 3, lines: { first: 10, last: 14 } }],
    ["§1#2:L7", { kind: "outline", number: "1", subIndex: 2, lines: { first: 7, last: 7 } }],
    ["§1#2!cAbC123xyz", { kind: "outline", number: "1", subIndex: 2, commentId: "AbC123xyz" }],
    ["templates/design-doc§1.2#1", { kind: "outline", number: "1.2", subIndex: 1, project: { kind: "templates", id: "design-doc" } }],
    ["wH34lrY2vA", { kind: "id", id: "wH34lrY2vA" }],
    ["wH34lrY2vA:L3-4", { kind: "id", id: "wH34lrY2vA", lines: { first: 3, last: 4 } }],
    ["sourcebook://projects/p1/subblocks/BP2Ra--OWJ#L2-5", { kind: "id", id: "BP2Ra--OWJ", lines: { first: 2, last: 5 }, project: { kind: "projects", id: "p1" } }],
    ["sourcebook://templates/t/sections/abcd1234", { kind: "id", id: "abcd1234", project: { kind: "templates", id: "t" } }],
  ])("%s", (input, expected) => {
    const parsed = parseRef(input);
    expect(Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined))).toEqual(expected);
  });

  it.each(["§2.1:L3", "§1#0", "§1#2:L5-2", "hello world", "../etc"])("rejects %s", (input) => {
    expect(() => parseRef(input)).toThrow();
  });

  it("parses projects", () => {
    expect(parseProject("example-project")).toEqual({ kind: "projects", id: "example-project" });
    expect(parseProject("templates/thesis")).toEqual({ kind: "templates", id: "thesis" });
    expect(parseProject("sourcebook://projects/x")).toEqual({ kind: "projects", id: "x" });
    expect(() => parseProject("Bad Name")).toThrow();
  });
});
