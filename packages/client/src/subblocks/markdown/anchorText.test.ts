// @vitest-environment jsdom
/**
 * Comments anchored through the API by source lines are quoted from the server's view of the Markdown's
 * visible text; the editor resolves them against TipTap's plain text. Both must agree.
 */
import { Editor } from "@tiptap/core";
import { resolveAnchor, createAnchor } from "@sourcebook/shared";
import { describe, expect, it } from "vitest";
import { markdownAnchorText } from "../../../../server/src/markdown/plainText";
import { docText } from "./commentHighlights";
import { markdownExtensions } from "./extensions";

const samples: Record<string, string> = {
  inline: "The API is **REST**, _typed_ and `fast` — see [docs](https://x.y).",
  headingsAndLists: "# Title\n\nIntro text.\n\n- item one\n- item **two**\n  - nested\n\n1. first\n2. second",
  quoteAndRule: "> quoted line\n\n---\n\nafter the rule",
  code: "Before\n\n```ts\nconst x = 1;\nconst y = 2;\n```\n\nAfter",
  table: "| a | b |\n| --- | --- |\n| one | two |",
  hardBreak: "line one\\\nline two",
};

const editorText = (md: string) => {
  const editor = new Editor({ extensions: markdownExtensions(), content: md, contentType: "markdown" });
  const t = docText(editor.state.doc).text;
  editor.destroy();
  return t;
};

describe("server and editor agree on Markdown text", () => {
  it.each(Object.entries(samples))("%s", (_name, md) => {
    expect(markdownAnchorText(md).text).toBe(editorText(md));
  });

  it("every source line's server anchor resolves in the editor to the same text", () => {
    for (const md of Object.values(samples)) {
      const server = markdownAnchorText(md);
      const client = editorText(md);
      for (let line = 1; line <= server.lineCount; line++) {
        const r = server.rangeOfLines(line, line);
        if (!r) continue;
        const anchor = createAnchor(server.text, r.from, r.to, "text");
        if (!anchor) continue;
        const found = resolveAnchor(client, anchor);
        expect(found && client.slice(found.from, found.to), `${JSON.stringify(md)} line ${line}`).toBe(anchor.exact);
      }
    }
  });
});
