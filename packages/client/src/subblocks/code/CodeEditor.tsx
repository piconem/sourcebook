import { CODE_LANGUAGES, languageById, type CodeContent, type TextRange } from "@sourcebook/shared";
import type { EditorView } from "@codemirror/view";
import { EditorView as View } from "codemirror";
import { useMemo, useRef, useState } from "react";
import { useCommentAnchoring, type AnchorAdapter } from "../../comments/useCommentAnchoring";
import { CodeMirror } from "../../components/CodeMirror";
import type { SubBlockProps } from "../types";
import { commentLines, commentRanges, setCommentRanges } from "./commentLines";

export function CodeEditor({ blockId, subBlock, onChange, commentBridge }: SubBlockProps<CodeContent>) {
  const [language, setLanguage] = useState(subBlock.content.language);
  const code = useRef(subBlock.content.code);
  const lang = languageById(language) ?? CODE_LANGUAGES[0];
  const [view, setView] = useState<EditorView | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const bridgeRef = useRef(commentBridge);
  bridgeRef.current = commentBridge;
  const onDocChangedRef = useRef<() => void>(() => {});

  // Extensions are fixed at mount; they reach the current bridge through refs.
  const extensions = useMemo(
    () => [
      ...(commentBridge
        ? [
            commentLines({
              onActivate: (id) => {
                bridgeRef.current?.setActive(id);
                bridgeRef.current?.openPanel?.();
              },
              onNewComment: (from, to) => {
                const b = bridgeRef.current;
                const v = viewRef.current;
                if (!b || !v) return;
                v.dispatch({ selection: { anchor: from, head: to } });
                const anchor = b.selectionAnchor?.();
                if (anchor) b.requestComment?.(anchor);
              },
            }),
          ]
        : []),
      View.updateListener.of((u) => {
        if (u.docChanged) onDocChangedRef.current();
        if (u.selectionSet || u.focusChanged) setHasSelection(!u.state.selection.main.empty && u.view.hasFocus);
      }),
    ],
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const viewRef = useRef<EditorView | null>(null);
  viewRef.current = view;

  const adapter = useMemo<AnchorAdapter | null>(() => {
    if (!view || !commentBridge) return null;
    return {
      getText: () => view.state.doc.toString(),
      getRanges: () => commentRanges(view.state),
      setRanges: (ranges: Map<string, TextRange>, active) => view.dispatch({ effects: setCommentRanges.of({ ranges, active }) }),
      // Lines anchors: the cursor alone designates its line.
      getSelection: () => ({ from: view.state.selection.main.from, to: view.state.selection.main.to }),
      reveal: (r) => view.dispatch({ effects: View.scrollIntoView(r.from, { y: "center" }) }),
    };
  }, [view, commentBridge]);
  const { onDocChanged } = useCommentAnchoring({
    blockId,
    subBlockId: subBlock.id,
    commentCount: subBlock.commentCount ?? 0,
    bridge: commentBridge,
    unit: "lines",
    adapter,
  });
  onDocChangedRef.current = onDocChanged;

  return (
    <div className="code-sub">
      <div className="sub-toolbar">
        <label>
          Language{" "}
          <select
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              onChange({ language: e.target.value, code: code.current });
            }}
          >
            {CODE_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">.{lang.ext}</span>
        {commentBridge && (
          <button
            type="button"
            className="comment-lines-btn"
            disabled={!view}
            title={hasSelection ? "Comment on the selected lines" : "Comment on the line with the cursor (or click the gutter)"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const anchor = commentBridge.selectionAnchor?.();
              if (anchor) commentBridge.requestComment?.(anchor);
            }}
          >
            💬+ {hasSelection ? "Comment lines" : "Comment line"}
          </button>
        )}
      </div>
      <CodeMirror
        initialValue={subBlock.content.code}
        ext={lang.ext}
        extensions={extensions}
        onView={setView}
        onChange={(value) => {
          code.current = value;
          onChange({ language, code: value });
        }}
      />
    </div>
  );
}
