import { describe, expect, it } from "vitest";
import { blockFileUrl, referenceHrefFromSubBlock, referencePathFromHref, referenceUrl, setNotebookBase } from "./client";

describe("reference links", () => {
  it("round-trips paths with spaces and unicode", () => {
    const path = "papers/2026/spec v1 – déf.pdf";
    const href = referenceHrefFromSubBlock(path);
    expect(href).toBe("../../../references/papers/2026/spec%20v1%20%E2%80%93%20d%C3%A9f.pdf");
    expect(referencePathFromHref(href)).toBe(path);
    expect(referencePathFromHref(href + "#page=3")).toBe(path);
  });
  it("ignores other links", () => {
    expect(referencePathFromHref("https://example.com/references/x.pdf")).toBeNull();
    expect(referencePathFromHref("../assets/x.png")).toBeNull();
  });
  it("builds file URLs inside the open project or template", () => {
    setNotebookBase("projects", "p1");
    expect(referenceUrl("a b/c.pdf", true)).toBe("/api/projects/p1/references/file/a%20b/c.pdf?download=1");
    setNotebookBase("templates", "design-doc");
    expect(blockFileUrl("b1", "assets/x.png")).toBe("/api/templates/design-doc/blocks/b1/files/assets/x.png");
  });
});
