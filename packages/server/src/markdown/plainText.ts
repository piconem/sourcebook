import type { Root, RootContent } from "mdast";
import { anchorTextFromPieces, type AnchorText, type LinePiece } from "@sourcebook/shared";
import { parseMarkdown } from "./remark.js";

/** Nodes rendered as one text block by the editor (joined with "\n", like the editor's plain text). */
const TEXT_BLOCKS = new Set(["paragraph", "heading", "tableCell"]);

/**
 * Visible text of a Markdown source (what the Markdown editor shows, without syntax), with each piece
 * mapped to its source line. Text blocks are separated by "\n", matching the editor's plain text used for
 * comment anchors; code blocks keep their content lines.
 */
export function markdownAnchorText(source: string): AnchorText {
  const tree = parseMarkdown(source);
  const lines = source.split("\n");
  let text = "";
  const pieces: LinePiece[] = [];
  let first = true;
  const newBlock = () => {
    if (!first) text += "\n";
    first = false;
  };
  /** Appends `value` whose first character is on `line`; embedded newlines advance the line. */
  const push = (value: string, line: number) => {
    value.split("\n").forEach((part, i) => {
      if (i > 0) text += "\n";
      pieces.push({ off: text.length, len: part.length, line: line + i });
      text += part;
    });
  };

  const walk = (node: RootContent | Root) => {
    const pos = "position" in node ? node.position : undefined;
    switch (node.type) {
      case "code": {
        newBlock();
        const start = pos?.start.line ?? 1;
        const fenced = /^\s*(```|~~~)/.test(lines[start - 1] ?? "");
        push(node.value, fenced ? start + 1 : start);
        return;
      }
      case "text":
      case "inlineCode":
        push(node.value, pos?.start.line ?? 1);
        return;
      case "break":
        text += "\n";
        return;
      case "html":
      case "image":
      case "imageReference":
      case "math":
      case "inlineMath":
        return; // not part of the editor's text
    }
    if (TEXT_BLOCKS.has(node.type)) newBlock();
    if ("children" in node) (node.children as RootContent[]).forEach(walk);
  };
  walk(tree);
  const lineCount = source.endsWith("\n") ? lines.length - 1 : lines.length;
  return anchorTextFromPieces(text, pieces, lineCount);
}
