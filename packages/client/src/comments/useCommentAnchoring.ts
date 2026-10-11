import { createAnchor, lineNumbers, resolveAnchor, type Comment, type CommentAnchor, type TextRange } from "@sourcebook/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { api } from "../api/client";
import { keys } from "../api/queries";
import { useBridge, type AnchorStatus, type CommentBridge } from "./bridge";

/** What an editor exposes, in plain-text offsets (the text anchors are made from). */
export interface AnchorAdapter {
  getText(): string;
  /** Current highlighted ranges by comment id (they follow edits). */
  getRanges(): Map<string, TextRange>;
  setRanges(ranges: Map<string, TextRange>, activeId: string | null): void;
  /** Current selection, or null when nothing suitable is selected. */
  getSelection(): TextRange | null;
  reveal(range: TextRange): void;
}

/**
 * Shared anchoring logic for text-based editors: resolves anchored comments into highlighted ranges,
 * keeps them following edits, reports attached/detached status, and refreshes stored anchors after saves.
 * Returns `onDocChanged`, to be called by the editor after each document change.
 */
export function useCommentAnchoring(opts: {
  blockId: string;
  subBlockId: string;
  commentCount: number;
  bridge: CommentBridge | undefined;
  unit: CommentAnchor["unit"];
  /** null until the editor is mounted. */
  adapter: AnchorAdapter | null;
}) {
  const { blockId, subBlockId, bridge, unit, adapter } = opts;
  const qc = useQueryClient();
  const key = keys.comments(blockId, subBlockId);
  const { data: comments } = useQuery({
    queryKey: key,
    queryFn: () => api.getComments(blockId, subBlockId),
    enabled: !!bridge && opts.commentCount > 0,
  });
  const { activeId } = useBridge(bridge);
  const anchoredRef = useRef<Comment[]>([]);
  // Resolved threads are not highlighted in the text.
  anchoredRef.current = (comments ?? []).filter((c) => c.anchor && !c.resolution);

  const report = useCallback(
    (ranges: Map<string, TextRange>) => {
      if (!bridge || !adapter) return;
      const text = unit === "lines" ? adapter.getText() : "";
      const status = new Map<string, AnchorStatus>();
      for (const c of anchoredRef.current) {
        const r = ranges.get(c.id);
        status.set(c.id, r ? { attached: true, lines: unit === "lines" ? lineNumbers(text, r) : undefined } : { attached: false });
      }
      bridge.setStatus(status);
    },
    [bridge, adapter, unit],
  );

  // Reconcile highlights with the comment list: keep live ranges, resolve new/changed anchors, drop deleted.
  // Anchor (serialized) each live range was resolved from: a changed anchor (re-attach) re-resolves.
  const resolvedAnchors = useRef(new Map<string, string>());
  useEffect(() => {
    if (!bridge || !adapter) return;
    const text = adapter.getText();
    const current = adapter.getRanges();
    const next = new Map<string, TextRange>();
    for (const c of anchoredRef.current) {
      const serialized = JSON.stringify(c.anchor);
      const sameAnchor = resolvedAnchors.current.get(c.id) === serialized;
      const r = (sameAnchor ? current.get(c.id) : undefined) ?? resolveAnchor(text, c.anchor!);
      if (r) next.set(c.id, r);
      resolvedAnchors.current.set(c.id, serialized);
    }
    adapter.setRanges(next, activeId);
    report(next);
  }, [comments, activeId, adapter, bridge, report]);

  // Capabilities offered to the comments column / BlockView.
  useEffect(() => {
    if (!bridge || !adapter) return;
    bridge.selectionAnchor = () => {
      const sel = adapter.getSelection();
      return sel ? createAnchor(adapter.getText(), sel.from, sel.to, unit) : null;
    };
    bridge.reveal = (id) => {
      const r = adapter.getRanges().get(id);
      if (r) adapter.reveal(r);
    };
    // After a save, store anchors whose saved version would no longer find the highlighted text.
    bridge.onSaved = async () => {
      const text = adapter.getText();
      const ranges = adapter.getRanges();
      const updates = new Map<string, CommentAnchor>();
      for (const c of anchoredRef.current) {
        const r = ranges.get(c.id);
        if (!r) continue; // detached: keep the original quote
        const found = resolveAnchor(text, c.anchor!);
        if (found && found.from === r.from && found.to === r.to) continue;
        const fresh = createAnchor(text, r.from, r.to, unit);
        if (fresh) updates.set(c.id, fresh);
      }
      if (!updates.size) return;
      await Promise.all([...updates].map(([id, anchor]) => api.setCommentAnchor(blockId, subBlockId, id, anchor)));
      for (const [id, anchor] of updates) resolvedAnchors.current.set(id, JSON.stringify(anchor));
      qc.setQueryData<Comment[]>(key, (list) => list?.map((c) => (updates.has(c.id) ? { ...c, anchor: updates.get(c.id) } : c)));
    };
    return () => {
      bridge.selectionAnchor = null;
      bridge.reveal = null;
      bridge.onSaved = null;
    };
  }, [bridge, adapter, unit, blockId, subBlockId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDocChanged = useCallback(() => {
    if (adapter) report(adapter.getRanges());
  }, [adapter, report]);

  return { onDocChanged, hasBridge: !!bridge };
}
