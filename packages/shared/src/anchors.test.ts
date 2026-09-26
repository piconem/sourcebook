import { describe, expect, it } from "vitest";
import { createAnchor, expandToLines, lineNumbers, resolveAnchor, sourceAnchorText } from "./anchors.js";

const doc = "The API is REST.\nThe API returns JSON.\nClients call the API often.";

describe("text anchors", () => {
  it("round-trips a selection", () => {
    const from = doc.indexOf("returns JSON");
    const a = createAnchor(doc, from, from + "returns JSON".length, "text")!;
    expect(a).toMatchObject({ unit: "text", exact: "returns JSON", start: from });
    expect(resolveAnchor(doc, a)).toEqual({ from, to: from + 12 });
  });

  it("picks the right occurrence by context, even after edits before it", () => {
    const second = doc.indexOf("API", 10); // "The API returns"
    const a = createAnchor(doc, second, second + 3, "text")!;
    const edited = "INTRO LINE ADDED\n" + doc.replace("REST", "a RESTful interface");
    const r = resolveAnchor(edited, a)!;
    expect(edited.slice(r.from - 4, r.to + 8)).toBe("The API returns");
  });

  it("falls back to the nearest occurrence when context is equal", () => {
    const text = "x a x\nx a x\nx a x";
    const a = { ...createAnchor(text, 8, 9, "text")!, prefix: "", suffix: "" };
    expect(resolveAnchor(text, a)).toEqual({ from: 8, to: 9 });
  });

  it("is detached when the quote is gone, and ignores blank selections", () => {
    const a = createAnchor(doc, 4, 7, "text")!;
    expect(resolveAnchor(doc.replaceAll("API", "service"), a)).toBeNull();
    expect(createAnchor(doc, 3, 4, "text")).toBeNull();
  });
});

describe("line anchors", () => {
  const code = "def f(x):\n    return x\n\ndef g(x):\n    return x\n";

  it("expands selections to whole lines", () => {
    expect(expandToLines(code, 12, 14)).toEqual({ from: 10, to: 22 });
    const a = createAnchor(code, 12, 14, "lines")!;
    expect(a.exact).toBe("    return x");
    expect(lineNumbers(code, resolveAnchor(code, a)!)).toEqual({ first: 2, last: 2 });
  });

  it("uses context to find the right duplicate line after lines move", () => {
    const at = code.lastIndexOf("    return x");
    const a = createAnchor(code, at, at, "lines")!; // cursor only: whole line
    expect(a.prefix.endsWith("def g(x):\n")).toBe(true);
    const moved = "import os\n" + code.replace("def g", "def h");
    const r = resolveAnchor(moved, { ...a, prefix: a.prefix.replace("def g", "def h") })!;
    expect(lineNumbers(moved, r)).toEqual({ first: 6, last: 6 });
  });

  it("requires whole-line matches and spans multiple lines", () => {
    const a = createAnchor(code, 0, 22, "lines")!;
    expect(a.exact).toBe("def f(x):\n    return x");
    expect(lineNumbers(code, resolveAnchor(code, a)!)).toEqual({ first: 1, last: 2 });
    expect(resolveAnchor("xx    return xx", { unit: "lines", exact: "    return x", prefix: "", suffix: "" })).toBeNull();
  });
});

describe("sourceAnchorText", () => {
  const src = "a = 1\n\nb = 2\nc = 3\n";
  const at = sourceAnchorText(src);
  it("maps lines to ranges and back", () => {
    expect(at.lineCount).toBe(4);
    const r = at.rangeOfLines(3, 4)!;
    expect(src.slice(r.from, r.to)).toBe("b = 2\nc = 3");
    expect(at.lineAt(r.from)).toBe(3);
    expect(at.lineAt(r.to - 1)).toBe(4);
    expect(at.rangeOfLines(2, 2)).toBeNull(); // blank line
  });
});
