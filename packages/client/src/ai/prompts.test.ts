import { describe, expect, it } from "vitest";
import { buildPrompt, modeBlocked, modesFor, referenceFor, type AiProject, type AiTarget } from "./prompts";

const project: AiProject = { kind: "projects", id: "payment-service", name: "Payment Service" };
const template: AiProject = { kind: "templates", id: "thesis", name: "Thesis" };
const sub = { ref: "§2.1#3", id: "BP2Ra--OWJ", type: "markdown", title: "Summary" };

describe("Ask AI: available modes", () => {
  it.each<[string, AiTarget, string[]]>([
    ["document", { kind: "document" }, ["brainstorm", "critique", "build", "comment", "custom"]],
    ["section", { kind: "section", number: "2.1", id: "b1", title: "Scope" }, ["brainstorm", "critique", "build", "improve", "comment", "custom"]],
    ["markdown sub-block", { kind: "subblock", ...sub }, ["brainstorm", "critique", "build", "improve", "comment", "custom"]],
    ["image sub-block", { kind: "subblock", ...sub, type: "image" }, ["brainstorm", "critique", "comment", "custom"]],
    ["drawing sub-block", { kind: "subblock", ...sub, type: "drawing" }, ["brainstorm", "critique", "comment", "custom"]],
    ["selection", { kind: "selection", ...sub, quote: "x" }, ["brainstorm", "critique", "build", "improve", "comment", "custom"]],
    ["comment", { kind: "comment", ...sub, commentId: "c1", author: "Mario", excerpt: "?" }, ["comment", "custom"]],
    ["reference", { kind: "reference", path: "papers/spec.md" }, ["brainstorm", "critique", "custom"]],
  ])("%s", (_n, target, modes) => expect(modesFor(target)).toEqual(modes));

  it("blocks writing modes in read-only mode", () => {
    expect(modeBlocked("improve", { readOnly: true })).toMatch(/read-only/);
    expect(modeBlocked("comment", { readOnly: true })).toMatch(/read-only/);
    expect(modeBlocked("critique", { readOnly: true })).toBeNull();
    expect(modeBlocked("improve", { readOnly: false })).toBeNull();
  });
});

describe("Ask AI: references", () => {
  it("identifies each target precisely", () => {
    expect(referenceFor(project, { kind: "document" })).toBe('Sourcebook project "payment-service" (whole document) · sourcebook://projects/payment-service/outline');
    expect(referenceFor(template, { kind: "section", number: "2.1", id: "b1", title: "Scope" })).toBe(
      'Sourcebook template "templates/thesis" · section §2.1 "Scope" · id b1 · sourcebook://templates/thesis/sections/b1',
    );
    expect(referenceFor(project, { kind: "subblock", ...sub })).toBe(
      'Sourcebook project "payment-service" · sub-block §2.1#3 (markdown "Summary") · id BP2Ra--OWJ · sourcebook://projects/payment-service/subblocks/BP2Ra--OWJ',
    );
    expect(referenceFor(project, { kind: "selection", ...sub, type: "code", lines: { first: 4, last: 6 } })).toContain("lines §2.1#3:L4-6 · sub-block id BP2Ra--OWJ · sourcebook://projects/payment-service/subblocks/BP2Ra--OWJ#L4-6");
    expect(referenceFor(project, { kind: "comment", ...sub, commentId: "c9", author: "Anna", excerpt: "Why?" })).toBe(
      'Sourcebook project "payment-service" · comment c9 on §2.1#3 · sourcebook://projects/payment-service/comments/c9',
    );
  });
});

describe("Ask AI: prompts", () => {
  it("names the MCP server, the target, how to read it and what to do", () => {
    const text = buildPrompt(project, { kind: "section", number: "2.1", id: "b1", title: "Scope" }, "critique", "");
    expect(text.split("\n")).toEqual([
      'Using the Sourcebook MCP server, work on project "Payment Service" (project "payment-service").',
      'Target: Sourcebook project "payment-service" · section §2.1 "Scope" · id b1 · sourcebook://projects/payment-service/sections/b1',
      'Read it with read_section (project "payment-service", section "§2.1" — id b1) and get_outline for context.',
      "",
      expect.stringMatching(/^Critically review section §2\.1 "Scope".*Do not change the content\.$/),
    ]);
  });

  it("adapts comment instructions to where comments can go", () => {
    expect(buildPrompt(project, { kind: "subblock", ...sub, type: "image" }, "comment", "")).toContain("add_comment on the whole sub-block");
    expect(buildPrompt(project, { kind: "selection", ...sub, type: "code", lines: { first: 3, last: 3 } }, "comment", "")).toContain("anchored to those lines");
    expect(buildPrompt(project, { kind: "selection", ...sub, quote: "returns JSON" }, "comment", "")).toContain("using the quoted passage as quote");
    expect(buildPrompt(project, { kind: "comment", ...sub, commentId: "c1", author: "Anna", excerpt: "Why?" }, "comment", "")).toContain("reply_to_comment");
  });

  it("appends the user's notes, or uses them as the request in custom mode", () => {
    expect(buildPrompt(template, { kind: "document" }, "build", "Focus on chapter 3")).toMatch(/Additional instructions: Focus on chapter 3$/);
    const custom = buildPrompt(project, { kind: "reference", path: "papers/spec.md" }, "custom", "Summarise it in 5 bullets");
    expect(custom).toContain('read_reference (project "payment-service", path "papers/spec.md")');
    expect(custom).toMatch(/Regarding the reference file references\/papers\/spec\.md:\nSummarise it in 5 bullets$/);
    expect(buildPrompt(project, { kind: "document" }, "custom", "  ")).toMatch(/\[write your request here\]$/);
  });

  it("uses the template path for templates", () => {
    expect(buildPrompt(template, { kind: "document" }, "brainstorm", "")).toContain('get_outline and read_document (project "templates/thesis")');
  });
});

describe("Ask AI: prompts use references the MCP server understands", async () => {
  const { parseRef, parseProject } = await import("../../../mcp/src/refs");
  const targets: AiTarget[] = [
    { kind: "section", number: "2.1", id: "blk_abc123", title: "Scope" },
    { kind: "subblock", ...sub },
    { kind: "selection", ...sub, type: "code", lines: { first: 4, last: 6 } },
    { kind: "comment", ...sub, commentId: "cmt_4567", author: "Anna", excerpt: "?" },
  ];
  it.each(targets.map((t) => [t.kind, t] as const))("%s", (_k, t) => {
    const text = buildPrompt(template, t, "critique", "");
    // Every quoted section/subblock/target argument in the read step parses as an MCP reference.
    const args = [...text.matchAll(/(?:section|subblock|target) "([^"]+)"/g)].map((m) => m[1]);
    expect(args.length).toBeGreaterThan(0);
    for (const a of args) expect(() => parseRef(a)).not.toThrow();
    // The project argument too, and the URI in the reference line.
    const project = /project "([^"]+)"\)/.exec(text)![1];
    expect(parseProject(project)).toEqual({ kind: "templates", id: "thesis" });
    const uri = /(sourcebook:\/\/\S+)/.exec(referenceFor(template, t))![1];
    expect(parseRef(uri)).toMatchObject({ project: { kind: "templates", id: "thesis" } });
  });
});
