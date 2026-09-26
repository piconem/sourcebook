import type { TextRange } from "@sourcebook/shared";
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Plain text of a ProseMirror document (text blocks separated by "\n", hard breaks as "\n") with
 * offset ↔ position mapping. Text anchors for Markdown comments are expressed in this text.
 */
export function docText(doc: PMNode) {
  let text = "";
  const segs: { off: number; pos: number; len: number }[] = [];
  let first = true;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (!first) text += "\n";
      first = false;
    } else if (node.isText) {
      segs.push({ off: text.length, pos, len: node.text!.length });
      text += node.text;
    } else if (node.type.name === "hardBreak") {
      segs.push({ off: text.length, pos, len: 1 });
      text += "\n";
    }
    return true;
  });
  const toPos = (off: number): number => {
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (off >= s.off) return off <= s.off + s.len ? s.pos + (off - s.off) : (segs[i + 1]?.pos ?? s.pos + s.len);
    }
    return segs[0]?.pos ?? 0;
  };
  const toOffset = (pos: number): number => {
    for (const s of segs) {
      if (pos < s.pos) return s.off;
      if (pos <= s.pos + s.len) return s.off + (pos - s.pos);
    }
    return text.length;
  };
  return { text, toPos, toOffset };
}

type Meta = { ranges: Map<string, TextRange>; active: string | null }; // ranges in document positions

export const commentHighlightsKey = new PluginKey<DecorationSet>("commentHighlights");

/** Inline highlights for anchored comments; they are mapped through every edit so they follow the text. */
export const CommentHighlights = Extension.create({
  name: "commentHighlights",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: commentHighlightsKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(commentHighlightsKey) as Meta | undefined;
            if (!meta) return set.map(tr.mapping, tr.doc);
            const decos = [...meta.ranges]
              .filter(([, r]) => r.to > r.from)
              .map(([id, r]) =>
                Decoration.inline(
                  r.from,
                  r.to,
                  { class: id === meta.active ? "comment-hl active" : "comment-hl", "data-comment-id": id },
                  { id, inclusiveStart: false, inclusiveEnd: false },
                ),
              );
            return DecorationSet.create(tr.doc, decos);
          },
        },
        props: { decorations: (state) => commentHighlightsKey.getState(state) },
      }),
    ];
  },
});

/** Current highlighted ranges (document positions) by comment id. */
export function highlightRanges(state: EditorState): Map<string, TextRange> {
  const out = new Map<string, TextRange>();
  for (const d of commentHighlightsKey.getState(state)?.find() ?? []) {
    const id = (d.spec as { id: string }).id;
    const r = out.get(id);
    out.set(id, r ? { from: Math.min(r.from, d.from), to: Math.max(r.to, d.to) } : { from: d.from, to: d.to });
  }
  return out;
}

export const setHighlightsMeta = (meta: Meta) => ({ key: commentHighlightsKey, meta });
