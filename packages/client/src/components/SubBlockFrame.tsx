import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SubBlock } from "@sourcebook/shared";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, api, notebookUri } from "../api/client";
import { keys } from "../api/queries";
import { originLabel, useExternalChange } from "../live/externalChanges";
import { registry } from "../subblocks";
import type { CommentBridge } from "../comments/bridge";
import { CopyReferenceButton } from "./CopyReferenceButton";
import { AskAiButton } from "../ai/AskAiButton";
import { ObjectiveField } from "./ObjectiveField";
import { useDebouncedSaver } from "./useDebouncedSaver";

export function SubBlockFrame(props: {
  blockId: string;
  subBlock: SubBlock;
  /** Called after pending edits are saved, with the latest content. */
  onDelete(latestContent: unknown): void;
  commentsOpen: boolean;
  onToggleComments(): void;
  onAddComment(): void;
  /** Link to the comments column (used by text-based types for text/line comments). */
  commentBridge?: CommentBridge;
  /** Outline reference, e.g. "§2.1#3" (for "Copy reference"). */
  refLabel?: string;
}) {
  const { blockId, subBlock } = props;
  const def = registry.get(subBlock.type);
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: subBlock.id,
  });

  const qc = useQueryClient();
  const latest = useRef(subBlock.content);
  // Revision this editor is based on; saves send it so changes made elsewhere are never overwritten silently.
  const knownRev = useRef(subBlock.rev ?? 0);
  const [editorKey, setEditorKey] = useState(0);
  const [conflict, setConflict] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const external = useExternalChange(subBlock.id);

  const { schedule, flush, cancel, isDirty, state, error } = useDebouncedSaver(
    useCallback(
      async (content: unknown) => {
        const exports = def?.exportArtifacts ? await def.exportArtifacts(content) : undefined;
        try {
          const saved = await api.updateSubBlock(blockId, subBlock.id, { content, exports, expectedRev: knownRev.current });
          knownRev.current = saved.rev ?? knownRev.current + 1;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            setConflict(originLabel(external?.origin));
            throw new Error("Not saved: this sub-block was changed elsewhere");
          }
          throw e;
        }
        // Anchored comments follow the edited text: persist anchors that moved.
        await props.commentBridge?.onSaved?.().catch(() => undefined);
      },
      [blockId, subBlock.id, def, props.commentBridge, external?.origin],
    ),
  );

  /** Reloads the stored version (fresh from the server) into the editor. */
  const reloadFromServer = async () => {
    const fresh = await qc.fetchQuery({ queryKey: keys.block(blockId), queryFn: () => api.getBlock(blockId), staleTime: 0 });
    const sub = fresh.subBlocks.find((s) => s.id === subBlock.id);
    if (!sub) return null;
    knownRev.current = sub.rev ?? 0;
    return sub;
  };

  // A newer revision arrived from elsewhere (the assistant, another window): show it, unless the user has
  // unsaved edits here — then ask which version to keep.
  useEffect(() => {
    const rev = subBlock.rev ?? 0;
    if (rev <= knownRev.current) return;
    if (isDirty() || state === "error") {
      setConflict(originLabel(external?.origin));
      return;
    }
    knownRev.current = rev;
    latest.current = subBlock.content;
    setEditorKey((k) => k + 1);
    setFlash(`Updated by ${originLabel(external?.origin)}`);
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [subBlock.rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTheirs = async () => {
    cancel();
    const sub = await reloadFromServer();
    if (sub) latest.current = sub.content;
    setConflict(null);
    setEditorKey((k) => k + 1);
  };
  const keepMine = async () => {
    await reloadFromServer();
    setConflict(null);
    schedule(latest.current);
    await flush();
  };

  // Diagrams/equations created without exports (e.g. by the assistant): render and store them once.
  const exportedForRev = useRef(-1);
  useEffect(() => {
    const rev = subBlock.rev ?? 0;
    if (!def?.exportArtifacts || subBlock.exports.length || exportedForRev.current === rev) return;
    exportedForRev.current = rev;
    let cancelled = false;
    def
      .exportArtifacts(subBlock.content)
      .then((assets) => {
        if (!cancelled && assets.length && knownRev.current === rev) return api.updateSubBlock(blockId, subBlock.id, { exports: assets });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [subBlock.rev, subBlock.exports.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Title and objective changed elsewhere: follow them unless being edited here.
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement === titleInput.current) return;
    setTitle(subBlock.title ?? "");
    savedTitle.current = subBlock.title ?? "";
  }, [subBlock.title]);
  useEffect(() => setObjective(subBlock.objective), [subBlock.objective]);



  // Expanded view: the same mounted editor is restyled as a full-page panel (no remount,
  // so editor state, undo history and Excalidraw scene are preserved).
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      // Excalidraw uses Esc itself (deselect, close menus); a dialog on top handles its own Esc.
      if (e.key === "Escape" && !(e.target as Element | null)?.closest?.(".excalidraw, dialog")) setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("subblock-expanded-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("subblock-expanded-open");
    };
  }, [expanded]);

  // Title and objective are metadata: saved directly (on blur), independently of content saves.
  const [title, setTitle] = useState(subBlock.title ?? "");
  const savedTitle = useRef(subBlock.title ?? "");
  const [objective, setObjective] = useState(subBlock.objective);
  const [showObjective, setShowObjective] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const saveMeta = async (body: { title?: string; objective?: string }) => {
    try {
      setMetaError(null);
      await api.updateSubBlock(blockId, subBlock.id, body);
    } catch (e) {
      setMetaError((e as Error).message);
    }
  };

  const Editor = def?.component;
  return (
    <>
    {expanded && <div className="subblock-backdrop" onClick={() => setExpanded(false)} />}
    <section
      ref={setNodeRef}
      className={`subblock${isDragging ? " dragging" : ""}${expanded ? " expanded" : ""}`}
      style={expanded ? undefined : { transform: CSS.Translate.toString(transform), transition }}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded || undefined}
    >
      <header className="subblock-head">
        {!expanded && (
          <button className="handle" ref={setActivatorNodeRef} {...attributes} {...listeners} title="Drag to reorder">
            ⠿
          </button>
        )}
        <span className="type" title={def?.label ?? subBlock.type}>
          {def?.icon}
        </span>
        <input
          ref={titleInput}
          className="sub-title"
          value={title}
          maxLength={200}
          placeholder={`${def?.label ?? subBlock.type} — add a title`}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (next === savedTitle.current) return;
            savedTitle.current = next;
            saveMeta({ title: next });
          }}
          onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && (e.target as HTMLInputElement).blur()}
        />
        <span className="file">{subBlock.source}</span>
        {flash && <span className="live-flash">{flash}</span>}
        <span className={`save ${state}`} title={error ?? undefined}>
          {state === "pending" || state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Save failed" : ""}
        </span>
        <div className="subblock-actions">
        <AskAiButton target={() => ({ kind: "subblock", ref: props.refLabel ?? subBlock.id, id: subBlock.id, type: subBlock.type, title: subBlock.title })} />
        <CopyReferenceButton text={`${props.refLabel ? `${props.refLabel} ` : ""}${notebookUri(`subblocks/${subBlock.id}`)}`} label={props.refLabel} />
        <button
          className={`icon comment-toggle${(subBlock.commentCount ?? 0) > 0 ? " has-comments" : ""}${props.commentsOpen ? " active" : ""}`}
          title={
            (subBlock.commentCount ?? 0) > 0
              ? `${subBlock.commentCount} comment${subBlock.commentCount === 1 ? "" : "s"} — ${props.commentsOpen ? "hide" : "show"}`
              : props.commentsOpen
                ? "Hide comments"
                : "No comments — show the comments column"
          }
          aria-label="Comments"
          aria-pressed={props.commentsOpen}
          onClick={props.onToggleComments}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill={(subBlock.commentCount ?? 0) > 0 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
          </svg>
          {(subBlock.commentCount ?? 0) > 0 && <span className="comment-count">{subBlock.commentCount}</span>}
        </button>
        <button className="icon" title="Add a comment" aria-label="Add a comment" onClick={props.onAddComment}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
            <path d="M12 8.5v7M8.5 12h7" />
          </svg>
        </button>
        {!objective && !showObjective && (
          <button className="icon" title="Add objective" aria-label="Add objective" onClick={() => setShowObjective(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="5" />
              <circle cx="12" cy="12" r="1" />
            </svg>
          </button>
        )}
        <button
          className="icon"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Exit full page (Esc)" : "Open in full page"}
          aria-label={expanded ? "Exit full page" : "Open in full page"}
        >
          {expanded ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          )}
        </button>
        <button
          className="danger"
          disabled={expanded}
          onClick={async () => {
            await flush();
            props.onDelete(latest.current);
          }}
          title="Delete sub-block"
        >
          ✕
        </button>
        </div>
      </header>
      {conflict ? (
        <div className="conflict-banner" role="alert">
          <span>
            <strong>Changed by {conflict}</strong> while you were editing. Which version do you want to keep?
          </span>
          <button onClick={loadTheirs}>Load their version</button>
          <button className="primary" onClick={keepMine}>
            Keep mine
          </button>
        </div>
      ) : (
        error && <p className="render-error">{error}</p>
      )}
      {metaError && <p className="render-error">{metaError}</p>}
      {(objective || showObjective) && (
        <div className="subblock-objective">
          <ObjectiveField
            value={objective}
            autoFocus={showObjective && !objective}
            onSave={(text) => {
              setObjective(text || undefined);
              saveMeta({ objective: text });
            }}
            onEmptyBlur={() => setShowObjective(false)}
            placeholder="Why is this here? What should it show or explain?"
          />
        </div>
      )}
      <div className="subblock-body surface">
        {Editor ? (
          <Suspense fallback={<p className="muted">Loading editor…</p>}>
            <Editor
              key={editorKey}
              refLabel={props.refLabel}
              blockId={blockId}
              subBlock={subBlock}
              onChange={(content: unknown) => {
                latest.current = content;
                schedule(content);
              }}
              saveNow={flush}
              commentBridge={def?.commentAnchor ? props.commentBridge : undefined}
            />
          </Suspense>
        ) : (
          <p className="render-error">No editor registered for type “{subBlock.type}”.</p>
        )}
      </div>
    </section>
    </>
  );
}
