import type { BibEntry } from "@sourcebook/shared";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { BibIcon } from "../../bibliography/CitationsButton";
import { PaperclipIcon } from "../../references/AttachmentsButton";
import { classifyLink, linkRanges, type LinkRange } from "./linkDecorations";

/** Replaces a link's target (and its text, when given), keeping it one link. */
export function replaceLink(editor: Editor, range: LinkRange, href: string, text?: string) {
  const chain = editor.chain().focus();
  if (text !== undefined && text !== range.text) {
    chain.insertContentAt({ from: range.from, to: range.to }, { type: "text", text, marks: [{ type: "link", attrs: { href } }] });
  } else {
    chain.setTextSelection({ from: range.from, to: range.to }).setLink({ href }).setTextSelection(range.to);
  }
  chain.run();
}

/** The link under the cursor (collapsed selection inside or at the edge of a link), with its position. */
function useLinkUnderCursor(editor: Editor, wrap: RefObject<HTMLDivElement | null>, bar: RefObject<HTMLDivElement | null>) {
  const [link, setLink] = useState<(LinkRange & { top: number; left: number }) | null>(null);
  useEffect(() => {
    const update = () => {
      // Unfocused (e.g. typing in the bar's URL field): leave the bar as it is; blur hides it when needed.
      if (!editor.isFocused) return;
      const { from, empty } = editor.state.selection;
      if (!empty) return setLink(null);
      const r = linkRanges(editor.state.doc).find((l) => from >= l.from && from <= l.to);
      if (!r) return setLink(null);
      let top = 0;
      let left = 0;
      try {
        const box = wrap.current!.getBoundingClientRect();
        const start = editor.view.coordsAtPos(r.from);
        const end = editor.view.coordsAtPos(r.to);
        top = Math.max(start.bottom, end.bottom) - box.top + 6;
        left = Math.max(0, Math.min(start.left - box.left, box.width - 360));
      } catch {
        // no layout (tests): top-left corner
      }
      setLink({ ...r, top, left });
    };
    // Keep the bar while the focus moves into it (e.g. the URL field).
    const hide = () => setTimeout(() => !editor.isFocused && !bar.current?.contains(document.activeElement) && setLink(null), 150);
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    editor.on("focus", update);
    editor.on("blur", hide);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      editor.off("focus", update);
      editor.off("blur", hide);
    };
  }, [editor, wrap, bar]);
  return [link, setLink] as const;
}

/**
 * Floating bar under the link at the cursor: what it points to, and Open / Change / Unlink / Remove.
 * Citations and reference files are changed with their pickers, web links edited inline.
 */
export function LinkBar(props: {
  editor: Editor;
  wrap: RefObject<HTMLDivElement | null>;
  bib: Map<string, BibEntry> | null;
  refs: Set<string>;
  onOpenCitation(key: string): void;
  onOpenReference(path: string): void;
  onChangeCitation(range: LinkRange): void;
  onChangeReference(range: LinkRange): void;
}) {
  const { editor } = props;
  const bar = useRef<HTMLDivElement>(null);
  const [link, setLink] = useLinkUnderCursor(editor, props.wrap, bar);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => setUrl(null), [link?.from, link?.href]);
  if (!link) return null;
  const target = classifyLink(link.href);
  const entry = target.kind === "bib" ? props.bib?.get(target.key) : undefined;
  const missing = target.kind === "bib" ? !!props.bib && !entry : target.kind === "ref" ? !props.refs.has(target.path) : false;
  const keep = (e: ReactMouseEvent) => !(e.target as HTMLElement).closest("input") && e.preventDefault();
  const done = () => setLink(null);

  const open = () => {
    if (target.kind === "bib") props.onOpenCitation(target.key);
    else if (target.kind === "ref") props.onOpenReference(target.path);
    else window.open(target.href, "_blank", "noopener,noreferrer");
  };
  const change = () => {
    if (target.kind === "bib") props.onChangeCitation(link);
    else if (target.kind === "ref") props.onChangeReference(link);
    else setUrl(link.href);
  };
  const applyUrl = () => {
    const next = url?.trim();
    if (next) replaceLink(editor, link, next);
    setUrl(null);
  };
  const unlink = () => {
    editor.chain().focus().setTextSelection({ from: link.from, to: link.to }).unsetLink().setTextSelection(link.to).run();
    done();
  };
  const remove = () => {
    editor.chain().focus().deleteRange({ from: link.from, to: link.to }).run();
    done();
  };

  return (
    <div ref={bar} className={`link-bar link-bar-${target.kind}`} style={{ top: link.top, left: link.left }} onMouseDown={keep} role="toolbar" aria-label="Link">
      <span className={`link-bar-target${missing ? " missing" : ""}`} title={link.href}>
        {target.kind === "bib" ? <BibIcon size={13} /> : target.kind === "ref" ? <PaperclipIcon size={13} /> : <span aria-hidden="true">🌐</span>}
        {target.kind === "bib" ? (
          entry ? (
            <>
              <strong>{entry.name}</strong>
              {entry.title && <span className="muted">{entry.title}</span>}
            </>
          ) : (
            <span>bib:{target.key} — not in the bibliography</span>
          )
        ) : target.kind === "ref" ? (
          <span>
            references/{target.path}
            {missing && " — missing file"}
          </span>
        ) : url === null ? (
          <span className="link-bar-url">{target.href}</span>
        ) : null}
      </span>
      {url !== null ? (
        <>
          <input
            className="link-bar-input"
            autoFocus
            value={url}
            aria-label="Link address"
            onChange={(e) => setUrl(e.target.value)}
            onBlur={(e) => !bar.current?.contains(e.relatedTarget as Node | null) && !editor.isFocused && done()}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.preventDefault(), applyUrl());
              if (e.key === "Escape") (e.preventDefault(), setUrl(null), editor.commands.focus());
            }}
          />
          <button type="button" className="primary" onClick={applyUrl}>
            Apply
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={open} disabled={missing} title={target.kind === "url" ? "Open in a new tab" : "Open (also Ctrl/⌘ + click)"}>
            Open
          </button>
          <button type="button" onClick={change} title={target.kind === "bib" ? "Cite another source" : target.kind === "ref" ? "Link another file" : "Edit the address"}>
            {target.kind === "url" ? "Edit" : "Change…"}
          </button>
          <button type="button" onClick={unlink} title="Remove the link, keep the text">
            Unlink
          </button>
          <button type="button" className="danger" onClick={remove} title="Delete the linked text">
            Remove
          </button>
        </>
      )}
    </div>
  );
}
