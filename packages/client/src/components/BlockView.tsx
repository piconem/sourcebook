import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import type { Block, BlockDeletionImpact, CommentAnchor, SubBlock } from "@sourcebook/shared";
import { CommentBridge } from "../comments/bridge";
import { Fragment, useContext, useEffect, useRef, useState } from "react";
import { FocusContext, flash } from "../live/focus";
import { api, notebookUri } from "../api/client";
import { CopyReferenceButton } from "./CopyReferenceButton";
import { CopyLinkButton } from "./CopyLinkButton";
import { AskAiButton } from "../ai/AskAiButton";
import { CitationsButton } from "../bibliography/CitationsButton";
import { AttachmentsButton } from "../references/AttachmentsButton";
import { keys, useBlock } from "../api/queries";
import { registry } from "../subblocks";
import { CommentsPanel } from "../comments/CommentsPanel";
import { Dialog } from "./Dialog";
import { ObjectiveField } from "./ObjectiveField";
import { InsertPoint } from "./InsertPoint";
import { SubBlockFrame } from "./SubBlockFrame";
import { NotificationBadge } from "../notifications/NotificationBadge";

export function BlockView({
  blockId,
  onDeleted,
  number,
  depth = 0,
}: {
  blockId: string;
  onDeleted(): void;
  /** Outline number shown before the title, e.g. "1.2". */
  number?: string;
  /** Nesting depth (smaller titles for sub-sections). */
  depth?: number;
}) {
  const qc = useQueryClient();
  const { data: block, error } = useBlock(blockId);
  const [title, setTitle] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [subDelete, setSubDelete] = useState<{ sub: SubBlock; assets: string[]; label: string } | null>(null);
  const [deleteAssets, setDeleteAssets] = useState(true);
  const [blockDelete, setBlockDelete] = useState<BlockDeletionImpact | null>(null);
  const [addingObjective, setAddingObjective] = useState(false);
  // Sub-blocks whose comment column is shown, and those with an open "new comment" box.
  const [commentsOpen, setCommentsOpen] = useState<ReadonlySet<string>>(() => new Set());
  // Open "new comment" boxes: anchor for text/line comments, null for the whole sub-block.
  const [composing, setComposing] = useState<ReadonlyMap<string, CommentAnchor | null>>(() => new Map());
  const setIn = (set: ReadonlySet<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };
  const setComposer = (id: string, anchor: CommentAnchor | null | undefined) =>
    setComposing((m) => {
      const next = new Map(m);
      if (anchor === undefined) next.delete(id);
      else next.set(id, anchor);
      return next;
    });
  const showComments = (id: string, on: boolean) => {
    setCommentsOpen((s) => setIn(s, id, on));
    if (!on) setComposer(id, undefined);
  };
  const startComment = (id: string, anchor: CommentAnchor | null = null) => {
    setCommentsOpen((s) => setIn(s, id, true));
    setComposer(id, anchor);
  };
  // One bridge per sub-block, linking its editor and its comments column.
  const bridges = useRef(new Map<string, CommentBridge>());
  const bridgeFor = (id: string) => {
    let b = bridges.current.get(id);
    if (!b) bridges.current.set(id, (b = new CommentBridge()));
    b.requestComment = (anchor) => startComment(id, anchor);
    b.openPanel = () => showComments(id, true);
    return b;
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  useEffect(() => setTitle(block?.title ?? ""), [block?.title]);

  // Deep link / notification: scroll to a sub-block of this section, and open one of its comments.
  const focus = useContext(FocusContext);
  const handledFocus = useRef(0);
  useEffect(() => {
    if (!block || !focus || focus.sectionId !== blockId || !focus.subBlockId || handledFocus.current === focus.seq) return;
    const { subBlockId, commentId } = focus;
    if (!block.subBlocks.some((s) => s.id === subBlockId)) return;
    handledFocus.current = focus.seq;
    if (commentId) showComments(subBlockId, true);
    setTimeout(() => {
      const el = document.getElementById(`subblock-${subBlockId}`);
      el?.scrollIntoView({ block: commentId ? "start" : "center", behavior: "smooth" });
      flash(el);
      if (commentId) {
        const bridge = bridgeFor(subBlockId);
        bridge.setActive(commentId);
        bridge.reveal?.(commentId);
      }
    }, focus.delay);
  }, [focus, block, blockId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="render-error">{(error as Error).message}</p>;
  if (!block) return <p className="muted">Loading…</p>;

  const run = async (fn: () => Promise<unknown>, { project = false } = {}) => {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      qc.invalidateQueries({ queryKey: keys.block(blockId) });
      if (project) {
        qc.invalidateQueries({ queryKey: keys.project });
        qc.invalidateQueries({ queryKey: keys.projectComments });
      }
    }
  };

  const saveTitle = () => {
    const t = title.trim();
    if (!t || t === block.title) return setTitle(block.title);
    run(() => api.updateBlock(blockId, { title: t }), { project: true });
  };

  const deleteSub = async (sub: SubBlock, withAssets: boolean) => {
    setSubDelete(null);
    await run(async () => {
      const r = await api.deleteSubBlock(blockId, sub.id, withAssets);
      setNotice(
        r.keptAssets.length
          ? `Kept ${r.keptAssets.join(", ")}: still referenced by other sub-blocks.`
          : r.deletedAssets.length
            ? `Deleted ${r.deletedAssets.join(", ")}.`
            : null,
      );
    }, { project: true });
  };

  /** Always asks for confirmation; files the sub-block references are listed (and optionally deleted too). */
  const requestSubDelete = (sub: SubBlock, latestContent: unknown, label: string) => {
    const assets = registry.get(sub.type)?.assetsOf?.(latestContent as never) ?? [];
    setDeleteAssets(true);
    setSubDelete({ sub, assets, label });
  };

  const requestBlockDelete = () =>
    run(async () => setBlockDelete(await api.blockDeletionImpact(blockId)));

  /** Inserts a new sub-block of `type` at `position` (index among the sub-blocks). */
  const insertSubBlock = (type: string, position: number) =>
    run(() => api.addSubBlock(blockId, position >= block.subBlocks.length ? { type } : { type, position }), { project: true });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = block.subBlocks.map((s) => s.id);
    const order = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    const byId = new Map(block.subBlocks.map((s) => [s.id, s]));
    qc.setQueryData<Block>(keys.block(blockId), { ...block, subBlocks: order.map((id) => byId.get(id)!) });
    run(() => api.reorderSubBlocks(blockId, order), { project: true });
  };

  return (
    <article className={`block-view${commentsOpen.size ? " with-comments" : ""}`}>
      <div className={`block-head depth-${Math.min(depth, 3)}`}>
        {number && <span className="block-number">{number}</span>}
        <CopyReferenceButton text={`${number ? `§${number} ` : ""}${notebookUri(`sections/${blockId}`)}`} label={number ? `§${number}` : undefined} />
        <CopyLinkButton target={{ sectionId: blockId }} label={number ? `§${number}` : undefined} />
        <AskAiButton target={() => ({ kind: "section", number: number ?? "?", id: blockId, title: block.title })} />
        <CitationsButton blockId={blockId} citations={block.citations} />
        <AttachmentsButton blockId={blockId} paths={block.references} />
        <input
          className="block-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <NotificationBadge blockId={blockId} subBlockId={null} />
        <span className="muted">blocks/{block.folder}</span>
        <button className="danger" onClick={requestBlockDelete}>
          Delete block
        </button>
      </div>
      {block.objective || addingObjective ? (
        <ObjectiveField
          value={block.objective}
          autoFocus={addingObjective && !block.objective}
          onSave={(objective) => run(() => api.updateBlock(blockId, { objective }))}
          onEmptyBlur={() => setAddingObjective(false)}
          placeholder="Why does this section exist? What should it explain or decide?"
        />
      ) : (
        <button className="link add-objective" onClick={() => setAddingObjective(true)}>
          + Add objective
        </button>
      )}
      {actionError && <p className="render-error">{actionError}</p>}
      {notice && (
        <p className="notice">
          {notice} <button className="link" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}

      <Dialog
        open={!!subDelete}
        title="Delete sub-block"
        onClose={() => setSubDelete(null)}
        actions={
          <>
            <button onClick={() => setSubDelete(null)}>Cancel</button>
            <button className="danger solid" onClick={() => subDelete && deleteSub(subDelete.sub, subDelete.assets.length > 0 && deleteAssets)}>
              Delete
            </button>
          </>
        }
      >
        <p>
          Delete {subDelete?.label} ({registry.get(subDelete?.sub.type ?? "")?.label ?? subDelete?.sub.type}) and its
          comments? This cannot be undone.
        </p>
        {!!subDelete?.assets.length && (
          <>
            <p>This sub-block references files stored in the project folder:</p>
            <ul className="file-list">
              {subDelete.assets.map((a) => <li key={a}>blocks/{block.folder}/{a}</li>)}
            </ul>
            <label className="check">
              <input type="checkbox" checked={deleteAssets} onChange={(e) => setDeleteAssets(e.target.checked)} />
              Also delete these files from the project folder
            </label>
            <p className="muted small">Files still referenced by other sub-blocks of this section are always kept.</p>
          </>
        )}
      </Dialog>

      <Dialog
        open={!!blockDelete}
        title={`Delete “${block.title}”`}
        onClose={() => setBlockDelete(null)}
        actions={
          <>
            <button onClick={() => setBlockDelete(null)}>Cancel</button>
            <button
              className="danger solid"
              onClick={() => {
                setBlockDelete(null);
                run(() => api.deleteBlock(blockId), { project: true }).then(onDeleted);
              }}
            >
              Delete everything
            </button>
          </>
        }
      >
        {blockDelete && (
          <>
            <p>The section folder and all its content will be permanently removed.</p>
            {blockDelete.blocks.length > 1 && (
              <>
                <p>Nested sections that will also be deleted:</p>
                <ul className="file-list">
                  {blockDelete.blocks.slice(1).map((b) => <li key={b.id}>{b.title}</li>)}
                </ul>
              </>
            )}
            {blockDelete.assets.length > 0 && (
              <>
                <p>Asset files that will be deleted:</p>
                <ul className="file-list">
                  {blockDelete.assets.map((a) => <li key={a}>{a}</li>)}
                </ul>
              </>
            )}
          </>
        )}
      </Dialog>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={block.subBlocks.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {block.subBlocks.map((s, i) => (
            <Fragment key={s.id}>
            <div className="subblock-row insert-row">
              <InsertPoint position={i} onInsert={insertSubBlock} />
              {commentsOpen.size > 0 && <div aria-hidden="true" />}
            </div>
            <div className={`subblock-row${commentsOpen.has(s.id) ? " commented" : ""}`}>
              <SubBlockFrame
                blockId={blockId}
                subBlock={s}
                onDelete={(latestContent) => requestSubDelete(s, latestContent, number ? `§${number}#${i + 1}` : `sub-block #${i + 1}`)}
                commentsOpen={commentsOpen.has(s.id)}
                onToggleComments={() => showComments(s.id, !commentsOpen.has(s.id))}
                onAddComment={() => startComment(s.id)}
                commentBridge={bridgeFor(s.id)}
                refLabel={number ? `§${number}#${i + 1}` : undefined}
              />
              {commentsOpen.has(s.id) ? (
                <CommentsPanel
                  blockId={blockId}
                  subBlock={s}
                  bridge={bridgeFor(s.id)}
                  refLabel={number ? `§${number}#${i + 1}` : undefined}
                  composing={composing.get(s.id)}
                  onCompose={(anchor) => setComposer(s.id, anchor)}
                  onCancelCompose={() => setComposer(s.id, undefined)}
                  onClose={() => showComments(s.id, false)}
                />
              ) : (
                commentsOpen.size > 0 && <div className="comments-gutter" aria-hidden="true" />
              )}
            </div>
            </Fragment>
          ))}
        </SortableContext>
      </DndContext>
      <div className="subblock-row insert-row">
        <InsertPoint
          persistent
          position={block.subBlocks.length}
          label={block.subBlocks.length === 0 ? "This section is empty. Add a sub-block:" : undefined}
          onInsert={insertSubBlock}
        />
        {commentsOpen.size > 0 && <div aria-hidden="true" />}
      </div>
    </article>
  );
}
