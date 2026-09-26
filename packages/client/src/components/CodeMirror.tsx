import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags as t } from "@lezer/highlight";
import { EditorView, basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

// Colors are CSS variables of the active theme, so one CodeMirror theme serves every app theme.
const theme = EditorView.theme({
  "&": { fontSize: "13px", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--field)", color: "var(--text)" },
  "&.cm-focused": { outline: "2px solid var(--accent-soft)" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  ".cm-content": { caretColor: "var(--text)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
    background: "var(--s-selection) !important",
  },
  ".cm-gutters": { background: "var(--code-bg)", color: "var(--muted)", borderRight: "1px solid var(--border)" },
  ".cm-activeLine": { background: "var(--s-active-line)" },
  ".cm-activeLineGutter": { background: "var(--s-active-line)", color: "var(--text)" },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { background: "var(--s-selection)", outline: "none" },
  ".cm-foldPlaceholder": { background: "var(--code-bg)", border: "1px solid var(--border)", color: "var(--muted)" },
  ".cm-tooltip, .cm-panels": { background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { background: "var(--accent-soft)", color: "var(--text)" },
  ".cm-searchMatch": { background: "var(--s-selection)", outline: "1px solid var(--border-strong)" },
  ".cm-panels input, .cm-panels button": { background: "var(--field)", color: "var(--text)", border: "1px solid var(--border)" },
});

const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword], color: "var(--syn-keyword)" },
    { tag: [t.string, t.special(t.string), t.regexp, t.inserted], color: "var(--syn-string)" },
    { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: "var(--syn-number)" },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--syn-comment)", fontStyle: "italic" },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: "var(--syn-function)" },
    { tag: [t.typeName, t.className, t.namespace, t.standard(t.variableName)], color: "var(--syn-type)" },
    { tag: [t.variableName, t.definition(t.variableName)], color: "var(--syn-variable)" },
    { tag: [t.propertyName, t.definition(t.propertyName)], color: "var(--syn-property)" },
    { tag: [t.meta, t.processingInstruction, t.annotation], color: "var(--syn-meta)" },
    { tag: [t.tagName, t.heading], color: "var(--syn-tag)", fontWeight: "600" },
    { tag: [t.attributeName], color: "var(--syn-attr)" },
    { tag: [t.operator, t.deleted], color: "var(--syn-operator)" },
    { tag: [t.link, t.url], color: "var(--syn-string)", textDecoration: "underline" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strong, fontWeight: "700" },
  ]),
);

/**
 * Thin CodeMirror 6 wrapper. `ext` (a file extension) selects the language; grammars are
 * lazy-loaded from @codemirror/language-data, unknown extensions fall back to plain text.
 */
export function CodeMirror(props: {
  initialValue: string;
  ext: string;
  readOnly?: boolean;
  maxHeight?: string;
  onChange?(value: string): void;
  /** Extra extensions, fixed at mount. */
  extensions?: Extension[];
  /** Receives the view after mount (null on unmount). */
  onView?(view: EditorView | null): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.initialValue,
        extensions: [
          basicSetup,
          theme,
          highlight,
          language.current.of([]),
          EditorState.readOnly.of(!!props.readOnly),
          EditorView.theme({ ".cm-scroller": { maxHeight: props.maxHeight ?? "none" } }),
          EditorView.updateListener.of((u) => u.docChanged && onChange.current?.(u.state.doc.toString())),
          ...(props.extensions ?? []),
        ],
      }),
    });
    view.current = v;
    props.onView?.(v);
    return () => {
      props.onView?.(null);
      v.destroy();
    };
    // The document is owned by CodeMirror after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    const desc = LanguageDescription.matchFilename(languages, `file.${props.ext}`);
    const apply = (ext: Parameters<Compartment["reconfigure"]>[0]) =>
      view.current?.dispatch({ effects: language.current.reconfigure(ext) });
    if (!desc) apply([]);
    else desc.load().then((support) => !cancelled && apply(support));
    return () => {
      cancelled = true;
    };
  }, [props.ext]);

  return <div ref={host} className="codemirror surface" />;
}
