// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { moveTableColumn, moveTableRow } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";
import { markdownExtensions } from "./extensions";

let editor: Editor;
afterEach(() => editor?.destroy());

const TABLE = "| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |";
const cells = (md: string) =>
  md
    .trim()
    .split("\n")
    .filter((l) => !/^\|\s*-/.test(l))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));

/** Places the cursor inside the cell whose text is `text`. */
function cursorIn(text: string) {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isText && node.text === text) pos = p;
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
}

describe("Markdown table editing", () => {
  it("adds, moves and deletes rows and columns", () => {
    editor = new Editor({ extensions: markdownExtensions(), content: TABLE, contentType: "markdown" });

    cursorIn("c");
    editor.commands.command(({ state, dispatch }) => moveTableRow({ from: 2, to: 1, select: false })(state, dispatch));
    expect(cells(editor.getMarkdown())).toEqual([["h1", "h2"], ["c", "d"], ["a", "b"]]);

    cursorIn("h1");
    editor.commands.command(({ state, dispatch }) => moveTableColumn({ from: 0, to: 1, select: false })(state, dispatch));
    expect(cells(editor.getMarkdown())).toEqual([["h2", "h1"], ["d", "c"], ["b", "a"]]);

    cursorIn("b");
    editor.commands.addRowAfter();
    editor.commands.addColumnAfter();
    expect(cells(editor.getMarkdown())).toEqual([
      ["h2", "", "h1"],
      ["d", "", "c"],
      ["b", "", "a"],
      ["", "", ""],
    ]);

    cursorIn("d");
    editor.commands.deleteRow();
    cursorIn("h1");
    editor.commands.deleteColumn();
    expect(cells(editor.getMarkdown())).toEqual([["h2", ""], ["b", ""], ["", ""]]);
  });

  it("keeps the language of code blocks", () => {
    editor = new Editor({
      extensions: markdownExtensions(),
      content: "```rust\nfn main() {}\n```",
      contentType: "markdown",
    });
    expect(editor.getJSON().content?.[0].attrs?.language).toBe("rust");
    editor.commands.updateAttributes("codeBlock", { language: "go" });
    expect(editor.getMarkdown().trim()).toBe("```go\nfn main() {}\n```");
  });
});
