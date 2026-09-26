// @vitest-environment jsdom
import mermaid from "mermaid";
import { describe, expect, it } from "vitest";
import { MERMAID_KINDS, detectKind, hasUserWork } from "./templates";

describe("mermaid templates", () => {
  it.each(MERMAID_KINDS.map((k) => [k.id, k] as const))("%s template parses and is detected", async (_id, kind) => {
    await expect(mermaid.parse(kind.template)).resolves.toBeTruthy();
    expect(detectKind(kind.template)?.id).toBe(kind.id);
  });

  it("detects kinds after comments and front matter", () => {
    expect(detectKind("%% note\n\ngraph TD\n A-->B")?.id).toBe("flowchart");
    expect(detectKind("---\ntitle: X\n---\nsequenceDiagram\n A->>B: hi")?.id).toBe("sequence");
    expect(detectKind("")).toBeUndefined();
  });

  it("only treats edited content as work to protect", () => {
    expect(hasUserWork("")).toBe(false);
    expect(hasUserWork(MERMAID_KINDS[1].template)).toBe(false);
    expect(hasUserWork(MERMAID_KINDS[1].template + "  Client->>Server: more\n")).toBe(true);
  });
});
