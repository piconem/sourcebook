import type { TextRange } from "@sourcebook/shared";
import { RangeSet, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from "@codemirror/view";

type Ranges = { ranges: Map<string, TextRange>; active: string | null };

export const setCommentRanges = StateEffect.define<Ranges>();

const mark = (id: string, active: boolean) =>
  Decoration.mark({ class: active ? "cm-comment-range active" : "cm-comment-range", attributes: { "data-comment-id": id }, id, inclusive: false });

/** Anchored ranges as mark decorations: mapped through edits, dropped when their text is deleted. */
const commentField = StateField.define<{ set: DecorationSet; active: string | null }>({
  create: () => ({ set: Decoration.none, active: null }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setCommentRanges)) {
        const decos = [...e.value.ranges]
          .filter(([, r]) => r.to > r.from)
          .sort(([, a], [, b]) => a.from - b.from)
          .map(([id, r]) => mark(id, id === e.value.active).range(r.from, r.to));
        return { set: Decoration.set(decos, true), active: e.value.active };
      }
    }
    return tr.docChanged ? { ...value, set: value.set.map(tr.changes) } : value;
  },
});

export function commentRanges(state: EditorState): Map<string, TextRange> {
  const out = new Map<string, TextRange>();
  state.field(commentField).set.between(0, state.doc.length, (from, to, d) => {
    const id = d.spec.id as string;
    const r = out.get(id);
    out.set(id, r ? { from: Math.min(r.from, from), to: Math.max(r.to, to) } : { from, to });
  });
  return out;
}

/** Background on every line covered by a comment (stronger for the active one). */
const lineHighlights = EditorView.decorations.compute([commentField], (state) => {
  const { set, active } = state.field(commentField);
  const lines = new Map<number, boolean>();
  set.between(0, state.doc.length, (from, to, d) => {
    const isActive = d.spec.id === active;
    for (let l = state.doc.lineAt(from).number; l <= state.doc.lineAt(Math.max(from, to - 1)).number; l++) {
      lines.set(state.doc.line(l).from, (lines.get(state.doc.line(l).from) ?? false) || isActive);
    }
  });
  return RangeSet.of(
    [...lines].sort(([a], [b]) => a - b).map(([pos, act]) => Decoration.line({ class: act ? "cm-comment-line active" : "cm-comment-line" }).range(pos)),
  );
});

class BubbleMarker extends GutterMarker {
  constructor(readonly ids: string[]) {
    super();
  }
  eq(other: BubbleMarker) {
    return other.ids.join() === this.ids.join();
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-comment-marker";
    el.textContent = this.ids.length > 1 ? `💬${this.ids.length}` : "💬";
    el.title = this.ids.length > 1 ? `${this.ids.length} comments` : "Comment";
    return el;
  }
}

export interface CommentLinesHandlers {
  /** Existing comment(s) clicked (marker or highlighted text). */
  onActivate(id: string): void;
  /** Request a new comment on [from, to) (whole lines). */
  onNewComment(from: number, to: number): void;
}

/** Gutter with a 💬 marker on the first line of each commented range; "+" on hover adds one. */
export function commentLines(handlers: CommentLinesHandlers): Extension {
  return [
    commentField,
    lineHighlights,
    gutter({
      class: "cm-comment-gutter",
      markers: (view) => {
        const starts = new Map<number, string[]>();
        view.state.field(commentField).set.between(0, view.state.doc.length, (from, _to, d) => {
          const line = view.state.doc.lineAt(from).from;
          starts.set(line, [...(starts.get(line) ?? []), d.spec.id as string]);
        });
        return RangeSet.of([...starts].sort(([a], [b]) => a - b).map(([pos, ids]) => new BubbleMarker(ids).range(pos)));
      },
      initialSpacer: () => new BubbleMarker(["x"]),
      domEventHandlers: {
        mousedown(view, line, event) {
          const ids: string[] = [];
          view.state.field(commentField).set.between(line.from, line.to, (from, _to, d) => {
            if (view.state.doc.lineAt(from).from === line.from) ids.push(d.spec.id as string);
          });
          event.preventDefault();
          if (ids.length) handlers.onActivate(ids[0]);
          else handlers.onNewComment(line.from, line.to);
          return true;
        },
      },
    }),
    EditorView.domEventHandlers({
      click(event) {
        const el = (event.target as HTMLElement).closest("[data-comment-id]");
        if (el) handlers.onActivate(el.getAttribute("data-comment-id")!);
        return false;
      },
    }),
  ];
}
