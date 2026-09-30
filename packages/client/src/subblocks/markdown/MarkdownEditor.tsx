import type { BibEntry, MarkdownContent, ReferenceNode } from "@sourcebook/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TextRange } from "@sourcebook/shared";
import { useCommentAnchoring, type AnchorAdapter } from "../../comments/useCommentAnchoring";
import { CommentHighlights, commentHighlightsKey, docText, highlightRanges } from "./commentHighlights";
import { referenceHrefFromSubBlock, referencePathFromHref } from "../../api/client";
import { AskAiButton } from "../../ai/AskAiButton";
import { copyText } from "../../clipboard";
import { ReferencePickerDialog } from "../../references/ReferencePickerDialog";
import { useOptionalBibliography } from "../../bibliography/BibliographyContext";
import { CitePickerDialog } from "../../bibliography/CitePickerDialog";
import { BibIcon } from "../../bibliography/CitationsButton";
import { LinkDecorations, bibKeyOf, linkDecorationsKey, type LinkRange } from "./linkDecorations";
import { LinkBar, replaceLink } from "./LinkBar";
import { useReferences } from "../../references/ReferencesContext";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import type { SubBlockProps } from "../types";
import { codeBlockWithPicker } from "./CodeBlockView";
import { markdownExtensions } from "./extensions";
import { TableToolbar } from "./TableToolbar";

function Toolbar({ editor, onLinkReference, onCite }: { editor: Editor; onLinkReference(): void; onCite?(): void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      code: e.isActive("code"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      codeBlock: e.isActive("codeBlock"),
      quote: e.isActive("blockquote"),
    }),
  });
  const btn = (label: string, active: boolean, run: () => void, title: string) => (
    <button type="button" className={active ? "tb active" : "tb"} title={title} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {label}
    </button>
  );
  const chain = () => editor.chain().focus();
  return (
    <div className="md-toolbar">
      {btn("B", state.bold, () => chain().toggleBold().run(), "Bold")}
      {btn("I", state.italic, () => chain().toggleItalic().run(), "Italic")}
      {btn("</>", state.code, () => chain().toggleCode().run(), "Inline code")}
      {btn("H2", state.h2, () => chain().toggleHeading({ level: 2 }).run(), "Heading 2")}
      {btn("H3", state.h3, () => chain().toggleHeading({ level: 3 }).run(), "Heading 3")}
      {btn("•", state.bullet, () => chain().toggleBulletList().run(), "Bullet list")}
      {btn("1.", state.ordered, () => chain().toggleOrderedList().run(), "Numbered list")}
      {btn("❝", state.quote, () => chain().toggleBlockquote().run(), "Quote")}
      {btn("{ }", state.codeBlock, () => chain().toggleCodeBlock().run(), "Code block (choose the language on the block)")}
      {btn("⊞", false, () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), "Insert table")}
      {btn("📎", false, onLinkReference, "Link a reference file")}
      {onCite && (
        <button type="button" className="tb tb-cite" title="Cite a source from the bibliography" onMouseDown={(e) => e.preventDefault()} onClick={onCite}>
          <BibIcon size={14} /> Cite
        </button>
      )}
    </div>
  );
}

/** Inserts a link to a reference: on the selection if any, otherwise with the file name as text. */
function insertReferenceLink(editor: Editor, node: ReferenceNode) {
  const href = referenceHrefFromSubBlock(node.path);
  const { empty } = editor.state.selection;
  const chain = editor.chain().focus();
  if (empty) {
    chain
      .insertContent([{ type: "text", text: node.name, marks: [{ type: "link", attrs: { href } }] }, { type: "text", text: " " }])
      .run();
  } else {
    chain.extendMarkRange("link").setLink({ href }).run();
  }
}

/** Inserts a citation `[Name](bib:key)`: on the selection if any, otherwise with the source name as text. */
function insertCitation(editor: Editor, entry: BibEntry) {
  const href = `bib:${entry.key}`;
  const chain = editor.chain().focus();
  if (editor.state.selection.empty) {
    chain.insertContent([{ type: "text", text: entry.name, marks: [{ type: "link", attrs: { href } }] }, { type: "text", text: " " }]).run();
  } else {
    chain.extendMarkRange("link").setLink({ href }).run();
  }
}

export function MarkdownEditor({ blockId, subBlock, onChange, commentBridge, refLabel }: SubBlockProps<MarkdownContent>) {
  // Open pickers: `replace` is the link being changed (from the link bar), otherwise a new link is inserted.
  const [picking, setPicking] = useState<{ replace?: LinkRange } | null>(null);
  const [citing, setCiting] = useState<{ replace?: LinkRange } | null>(null);
  const references = useReferences();
  const bib = useOptionalBibliography();
  const bibRef = useRef(bib);
  bibRef.current = bib;
  const refPaths = useMemo(() => new Set(references.files.map((f) => f.path)), [references.files]);
  const refPathsRef = useRef<Set<string> | null>(null);
  refPathsRef.current = references.tree ? refPaths : null;
  const bridgeRef = useRef(commentBridge);
  bridgeRef.current = commentBridge;
  const editor = useEditor({
    editorProps: {
      handleDOMEvents: {
        // Click on commented text: highlight the comment in the column (cursor placement still happens).
        click: (_view, event) => {
          const hl = (event.target as HTMLElement).closest("[data-comment-id]");
          if (hl && bridgeRef.current && !(event.ctrlKey || event.metaKey)) {
            bridgeRef.current.setActive(hl.getAttribute("data-comment-id"));
            bridgeRef.current.openPanel?.();
          }
          return false;
        },
      },
      handleClick: (_view, _pos, event) => {
        // Ctrl/⌘ + click on a link to a reference opens it in the viewer.
        if (!(event.ctrlKey || event.metaKey)) return false;
        const a = (event.target as HTMLElement).closest("a");
        const citation = bibKeyOf(a?.getAttribute("href"));
        if (citation !== null && bibRef.current) {
          event.preventDefault();
          bibRef.current.open(citation);
          return true;
        }
        const path = a && referencePathFromHref(a.getAttribute("href") ?? "");
        if (!path) return false;
        event.preventDefault();
        references.open(path);
        return true;
      },
    },
    extensions: [
      ...markdownExtensions(codeBlockWithPicker),
      CommentHighlights,
      LinkDecorations(() => ({ bib: bibRef.current?.loaded ? bibRef.current.byKey : null, refs: refPathsRef.current })),
    ],
    content: subBlock.content.markdown,
    contentType: "markdown",
    onUpdate: ({ editor: e }) => onChange({ markdown: e.getMarkdown() }),
  });
  // ---- anchored comments ----
  const adapter = useMemo<AnchorAdapter | null>(() => {
    if (!editor) return null;
    return {
      getText: () => docText(editor.state.doc).text,
      getRanges: () => {
        const t = docText(editor.state.doc);
        const out = new Map<string, TextRange>();
        for (const [id, r] of highlightRanges(editor.state)) out.set(id, { from: t.toOffset(r.from), to: t.toOffset(r.to) });
        return out;
      },
      setRanges: (ranges, active) => {
        const t = docText(editor.state.doc);
        const pos = new Map([...ranges].map(([id, r]) => [id, { from: t.toPos(r.from), to: t.toPos(r.to) }]));
        editor.view.dispatch(editor.state.tr.setMeta(commentHighlightsKey, { ranges: pos, active }).setMeta("addToHistory", false));
      },
      getSelection: () => {
        const { from, to, empty } = editor.state.selection;
        if (empty) return null;
        const t = docText(editor.state.doc);
        return { from: t.toOffset(from), to: t.toOffset(to) };
      },
      reveal: (r) => {
        const pos = docText(editor.state.doc).toPos(r.from);
        const dom = editor.view.domAtPos(pos).node;
        (dom instanceof Element ? dom : dom.parentElement)?.scrollIntoView({ block: "center", behavior: "smooth" });
      },
    };
  }, [editor]);
  const { onDocChanged } = useCommentAnchoring({
    blockId,
    subBlockId: subBlock.id,
    commentCount: subBlock.commentCount ?? 0,
    bridge: commentBridge,
    unit: "text",
    adapter,
  });

  // Link icons and "missing" flags follow the bibliography and the reference files.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(linkDecorationsKey, true).setMeta("addToHistory", false));
  }, [editor, bib?.byKey, bib?.loaded, refPaths]);

  // Floating "comment" button next to a non-empty selection.
  const wrap = useRef<HTMLDivElement>(null);
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!editor || !commentBridge) return;
    const update = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || !editor.isFocused || !wrap.current) return setBubble(null);
      const box = wrap.current.getBoundingClientRect();
      try {
        const end = editor.view.coordsAtPos(to);
        const start = editor.view.coordsAtPos(from);
        setBubble({ top: Math.max(0, Math.min(start.top, end.top) - box.top - 34), left: Math.min(end.right, box.right - 40) - box.left });
      } catch {
        setBubble({ top: 0, left: box.width - 60 }); // no layout information: top-right corner
      }
    };
    const onTr = ({ transaction }: { transaction: { docChanged: boolean } }) => transaction.docChanged && onDocChanged();
    const hide = () => setTimeout(() => !editor.isFocused && setBubble(null), 150);
    editor.on("selectionUpdate", update);
    editor.on("focus", update);
    editor.on("blur", hide);
    editor.on("transaction", onTr);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("focus", update);
      editor.off("blur", hide);
      editor.off("transaction", onTr);
    };
  }, [editor, commentBridge, onDocChanged]);

  if (!editor) return null;
  return (
    <div className="md-editor" ref={wrap}>
      {bubble && commentBridge && (
        <button
          type="button"
          className="selection-comment"
          style={{ top: bubble.top, left: bubble.left }}
          title="Comment on the selected text"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const anchor = commentBridge.selectionAnchor?.();
            if (anchor) commentBridge.requestComment?.(anchor);
            setBubble(null);
          }}
        >
          💬+ Comment
        </button>
      )}
      {bubble && (
        <span className="selection-ask-ai" style={{ top: bubble.top, left: bubble.left + (refLabel ? 210 : 110) }}>
          <AskAiButton
            className="selection-comment ask"
            label="Ask AI"
            target={() => {
              const { from, to } = editor.state.selection;
              return { kind: "selection", ref: refLabel ?? subBlock.id, id: subBlock.id, type: "markdown", title: subBlock.title, quote: editor.state.doc.textBetween(from, to, "\n").slice(0, 1000) };
            }}
          />
        </span>
      )}
      {bubble && refLabel && (
        <button
          type="button"
          className="selection-comment copy"
          style={{ top: bubble.top, left: bubble.left + 110 }}
          title="Copy a reference to the selected text, to paste in a chat with the assistant"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const { from, to } = editor.state.selection;
            const quote = editor.state.doc.textBetween(from, to, "\n").slice(0, 300);
            void copyText(`${refLabel} "${quote}"`);
            setBubble(null);
          }}
        >
          🔗 Copy ref
        </button>
      )}
      <Toolbar editor={editor} onLinkReference={() => setPicking({})} onCite={bib ? () => setCiting({}) : undefined} />
      <LinkBar
        editor={editor}
        wrap={wrap}
        bib={bib?.loaded ? bib.byKey : null}
        refs={refPaths}
        onOpenCitation={(key) => bib?.open(key)}
        onOpenReference={references.open}
        onChangeCitation={(range) => setCiting({ replace: range })}
        onChangeReference={(range) => setPicking({ replace: range })}
      />
      {bib && (
        <CitePickerDialog
          open={!!citing}
          title={citing?.replace ? "Cite another source" : undefined}
          onClose={() => setCiting(null)}
          onPick={(entry) => {
            const replace = citing?.replace;
            setCiting(null);
            if (!replace) return insertCitation(editor, entry);
            // The text follows the new source when it was the old source's name.
            const old = bib.byKey.get(bibKeyOf(replace.href) ?? "");
            replaceLink(editor, replace, `bib:${entry.key}`, !old || replace.text === old.name ? entry.name : undefined);
          }}
        />
      )}
      <ReferencePickerDialog
        open={!!picking}
        title={picking?.replace ? "Link another file" : undefined}
        onClose={() => setPicking(null)}
        onPick={(node) => {
          const replace = picking?.replace;
          setPicking(null);
          if (!replace) return insertReferenceLink(editor, node);
          // The text follows the new file when it was the old file's name (with or without extension).
          const oldName = decodeURIComponent(replace.href.split(/[?#]/)[0].split("/").pop() ?? "");
          const wasName = replace.text === oldName || replace.text === oldName.replace(/\.[^.]+$/, "");
          replaceLink(editor, replace, referenceHrefFromSubBlock(node.path), wasName ? node.name : undefined);
        }}
      />
      <TableToolbar editor={editor} />
      <EditorContent editor={editor} className="md-content" />
    </div>
  );
}
