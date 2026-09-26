// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "./extensions";
import { fixtures } from "./fixtures";

const norm = (s: string) => s.replace(/\n{3,}/g, "\n\n").trim();
const roundTrip = (md: string) => {
  const editor = new Editor({ extensions: markdownExtensions(), content: md, contentType: "markdown" });
  const out = editor.getMarkdown();
  editor.destroy();
  return out;
};

describe("Markdown sub-block bridge (@tiptap/markdown)", () => {
  // Cosmetic normalizations (table padding, hard-break syntax) are allowed but must be stable.
  it.each(Object.entries(fixtures))("%s round-trips stably", (_name, md) => {
    const once = roundTrip(md);
    expect(norm(roundTrip(once))).toBe(norm(once));
    expect(norm(roundTrip(md).replace(/ +\|/g, " |").replace(/ {2}\n/g, "\\\n"))).toBe(
      norm(md.replace(/ +\|/g, " |")),
    );
  });
});
