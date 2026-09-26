import type { CommentAnchor } from "./schemas.js";

/** Characters of context stored before/after the quote. */
export const ANCHOR_CONTEXT = 32;

export interface TextRange {
  from: number;
  to: number;
}

const lineStart = (text: string, i: number) => text.lastIndexOf("\n", i - 1) + 1;
const lineEnd = (text: string, i: number) => {
  const n = text.indexOf("\n", i);
  return n === -1 ? text.length : n;
};

/** For "lines" anchors: widen a range to whole lines (a range ending at a line start stops before it). */
export function expandToLines(text: string, from: number, to: number): TextRange {
  let end = to;
  if (end > from && text[end - 1] === "\n") end--;
  return { from: lineStart(text, from), to: lineEnd(text, Math.max(from, end)) };
}

/** Builds an anchor for text[from, to). Returns null for an empty or blank range. */
export function createAnchor(text: string, from: number, to: number, unit: CommentAnchor["unit"]): CommentAnchor | null {
  const r = unit === "lines" ? expandToLines(text, from, to) : { from, to };
  const exact = text.slice(r.from, r.to);
  if (!exact.trim()) return null;
  return {
    unit,
    exact: exact.slice(0, 5000),
    prefix: text.slice(Math.max(0, r.from - ANCHOR_CONTEXT), r.from),
    suffix: text.slice(r.to, r.to + ANCHOR_CONTEXT),
    start: r.from,
  };
}

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Finds the anchor's quote in `text`. Among several occurrences, prefers the one whose surrounding
 * text best matches the stored context, then the one closest to the original offset. For "lines"
 * anchors the match must span whole lines. Returns null when the quote no longer exists (detached).
 */
export function resolveAnchor(text: string, anchor: CommentAnchor): TextRange | null {
  const { exact } = anchor;
  if (!exact) return null;
  let best: { range: TextRange; score: number } | null = null;
  for (let i = text.indexOf(exact), seen = 0; i !== -1 && seen < 1000; i = text.indexOf(exact, i + 1), seen++) {
    const to = i + exact.length;
    if (anchor.unit === "lines" && ((i > 0 && text[i - 1] !== "\n") || (to < text.length && text[to] !== "\n"))) continue;
    const context =
      commonSuffix(text.slice(Math.max(0, i - anchor.prefix.length), i), anchor.prefix) +
      commonPrefix(text.slice(to, to + anchor.suffix.length), anchor.suffix);
    const distance = anchor.start === undefined ? 0 : Math.abs(i - anchor.start) / (text.length + 1);
    const score = context - distance; // distance < 1 only breaks ties between equal contexts
    if (!best || score > best.score) best = { range: { from: i, to }, score };
  }
  return best?.range ?? null;
}

/** 1-based first/last line numbers of a range. */
export function lineNumbers(text: string, range: TextRange): { first: number; last: number } {
  const count = (s: string) => (s.match(/\n/g)?.length ?? 0) + 1;
  const first = count(text.slice(0, range.from));
  return { first, last: first + count(text.slice(range.from, Math.max(range.from, range.to))) - 1 };
}

/**
 * Text that anchors are made from, with a mapping to 1-based lines of the source file. For line-based types
 * the text is the source itself; text-based types (Markdown) provide one derived from their source.
 */
export interface AnchorText {
  text: string;
  /** Source line of a text offset. */
  lineAt(offset: number): number;
  /** Text range covering the given source lines, or null if they hold no text. */
  rangeOfLines(first: number, last: number): TextRange | null;
  /** Number of lines in the source. */
  lineCount: number;
}

/** Pieces of text, each on one source line, in text order. */
export interface LinePiece {
  off: number;
  len: number;
  line: number;
}

export function anchorTextFromPieces(text: string, pieces: LinePiece[], lineCount: number): AnchorText {
  return {
    text,
    lineCount,
    lineAt(offset) {
      let line = pieces[0]?.line ?? 1;
      for (const p of pieces) {
        if (p.off > offset) break;
        line = p.line;
      }
      return line;
    },
    rangeOfLines(first, last) {
      const inRange = pieces.filter((p) => p.line >= first && p.line <= last && p.len > 0);
      if (!inRange.length) return null;
      return { from: inRange[0].off, to: inRange[inRange.length - 1].off + inRange[inRange.length - 1].len };
    },
  };
}

/** AnchorText for sources whose text is the file itself (code). */
export function sourceAnchorText(source: string): AnchorText {
  const pieces: LinePiece[] = [];
  let off = 0;
  source.split("\n").forEach((l, i) => {
    pieces.push({ off, len: l.length, line: i + 1 });
    off += l.length + 1;
  });
  const lineCount = source.endsWith("\n") ? pieces.length - 1 : pieces.length;
  return anchorTextFromPieces(source, pieces, lineCount);
}
