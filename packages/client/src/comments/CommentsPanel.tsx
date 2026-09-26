import type { Comment, CommentAnchor, CommentReply, SubBlock } from "@sourcebook/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { keys, useUser } from "../api/queries";
import { Avatar } from "../components/Avatar";
import { useBridge, type AnchorStatus, type CommentBridge } from "./bridge";
import { fullTime, relativeTime } from "./time";

/** Textarea + submit/cancel; Ctrl/⌘+Enter submits, Esc cancels. */
function Composer(props: { placeholder: string; submitLabel: string; onSubmit(text: string): Promise<void>; onCancel(): void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onSubmit(text.trim());
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="composer">
      <textarea
        ref={area}
        rows={2}
        value={text}
        placeholder={props.placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
          if (e.key === "Escape") props.onCancel();
        }}
      />
      {error && <p className="render-error">{error}</p>}
      <div className="composer-actions">
        <span className="muted small">Ctrl/⌘ + Enter</span>
        <button onClick={props.onCancel}>Cancel</button>
        <button className="primary" disabled={!text.trim() || busy} onClick={submit}>
          {props.submitLabel}
        </button>
      </div>
    </div>
  );
}

function Entry({ entry, onDelete, kind }: { entry: Comment | CommentReply; onDelete(): Promise<void>; kind: "comment" | "reply" }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className={`comment-entry ${kind}`}>
      <div className="comment-meta">
        <Avatar name={entry.author.name} username={entry.author.username} size={kind === "comment" ? 26 : 22} />
        <div className="comment-who">
          <span className="comment-name">{entry.author.name}</span>
          <span className="muted small">
            @{entry.author.username} · <time dateTime={entry.createdAt} title={fullTime(entry.createdAt)}>{relativeTime(entry.createdAt)}</time>
          </span>
        </div>
        {confirming ? (
          <span className="comment-confirm">
            <button className="link danger" onClick={() => onDelete().finally(() => setConfirming(false))}>
              Delete{kind === "comment" && "replies" in entry && entry.replies.length ? " thread" : ""}
            </button>
            <button className="link" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button className="icon comment-delete" title={`Delete ${kind}`} aria-label={`Delete ${kind}`} onClick={() => setConfirming(true)}>
            ✕
          </button>
        )}
      </div>
      <p className="comment-text">{entry.text}</p>
    </div>
  );
}

/** Quoted text a comment points to, with its current state. */
function Quote({ anchor, status }: { anchor: CommentAnchor; status: AnchorStatus | undefined }) {
  const detached = status?.attached === false;
  const lines =
    anchor.unit === "lines" && status?.lines
      ? status.lines.first === status.lines.last
        ? `Line ${status.lines.first}`
        : `Lines ${status.lines.first}–${status.lines.last}`
      : null;
  const exact = anchor.exact.length > 160 ? `${anchor.exact.slice(0, 160)}…` : anchor.exact;
  return (
    <div className={`comment-quote${detached ? " detached" : ""}${anchor.unit === "lines" ? " code" : ""}`}>
      {lines && <span className="comment-quote-lines">{lines}</span>}
      <span className="comment-quote-text">{exact}</span>
      {detached && <span className="comment-detached">Text changed — no longer found in this sub-block</span>}
    </div>
  );
}

/**
 * Word-style comment column for one sub-block: threads oldest first (on the whole sub-block, or anchored
 * to text/lines), each with replies, plus an optional new-comment box at the end.
 */
export function CommentsPanel(props: {
  blockId: string;
  subBlock: SubBlock;
  bridge: CommentBridge;
  /** undefined: no new-comment box; null: box for the whole sub-block; anchor: box for that text. */
  composing: CommentAnchor | null | undefined;
  onCompose(anchor: CommentAnchor | null): void;
  onCancelCompose(): void;
  onClose(): void;
}) {
  const { blockId, subBlock, bridge } = props;
  const qc = useQueryClient();
  const { data: user } = useUser();
  const key = keys.comments(blockId, subBlock.id);
  const { data: comments, error } = useQuery({ queryKey: key, queryFn: () => api.getComments(blockId, subBlock.id) });
  const { activeId, status } = useBridge(bridge);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);

  // Bring the active thread into view when it is activated from the editor.
  useEffect(() => {
    if (!activeId) return;
    panel.current?.querySelector(`[data-thread="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  /** Refetch the thread list and keep the sub-block's comment count in the block cache in sync. */
  const refresh = async () => {
    const list = await qc.fetchQuery({ queryKey: key, queryFn: () => api.getComments(blockId, subBlock.id), staleTime: 0 });
    qc.setQueryData(keys.block(blockId), (b: { subBlocks: SubBlock[] } | undefined) =>
      b && { ...b, subBlocks: b.subBlocks.map((s) => (s.id === subBlock.id ? { ...s, commentCount: list.length } : s)) },
    );
  };

  const reattach = async (c: Comment) => {
    const anchor = bridge.selectionAnchor?.();
    if (!anchor) return setNotice("Select the text (or lines) to attach the comment to, then click “Attach to selection”.");
    setNotice(null);
    await api.setCommentAnchor(blockId, subBlock.id, c.id, anchor);
    await refresh();
    bridge.setActive(c.id);
  };

  const title = subBlock.title || `${subBlock.type} ${subBlock.order}`;
  const detachedCount = [...status.values()].filter((s) => !s.attached).length;
  return (
    <aside ref={panel} className="comments-panel" aria-label={`Comments on ${title}`}>
      <header className="comments-head">
        <span>
          Comments{comments?.length ? ` (${comments.length})` : ""} <span className="muted small">· {title}</span>
        </span>
        {props.composing === undefined && (
          <button className="icon" title="Comment on the whole sub-block" aria-label="Add comment" onClick={() => props.onCompose(null)}>
            ＋
          </button>
        )}
        <button className="icon" title="Hide comments" aria-label="Hide comments" onClick={props.onClose}>
          ✕
        </button>
      </header>
      {bridge.supportsAnchors && (
        <p className="muted small comments-hint">
          {subBlock.type === "code" ? "Select lines or click the gutter to comment on code." : "Select text to comment on it."}
          {detachedCount > 0 && ` ${detachedCount} comment${detachedCount === 1 ? " has" : "s have"} lost its text.`}
        </p>
      )}
      {notice && <p className="notice small">{notice}</p>}
      {error && <p className="render-error">{(error as Error).message}</p>}
      {!comments && !error && <p className="muted small">Loading…</p>}
      {comments?.length === 0 && props.composing === undefined && <p className="muted small comments-empty">No comments yet.</p>}
      {comments?.map((c) => {
        const st = c.anchor ? status.get(c.id) : undefined;
        return (
          <article
            key={c.id}
            data-thread={c.id}
            className={`comment-thread${activeId === c.id ? " active" : ""}${st?.attached === false ? " is-detached" : ""}`}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button, textarea, a")) return;
              bridge.setActive(activeId === c.id ? null : c.id);
              if (c.anchor && activeId !== c.id) bridge.reveal?.(c.id);
            }}
          >
            {c.anchor && <Quote anchor={c.anchor} status={st} />}
            <Entry kind="comment" entry={c} onDelete={() => api.deleteComment(blockId, subBlock.id, c.id).then(refresh)} />
            {c.replies.map((r) => (
              <Entry key={r.id} kind="reply" entry={r} onDelete={() => api.deleteComment(blockId, subBlock.id, c.id, r.id).then(refresh)} />
            ))}
            {c.anchor && st?.attached === false && (
              <div className="comment-detached-actions">
                {bridge.supportsAnchors && (
                  <button className="link" onClick={() => reattach(c)}>
                    Attach to selection
                  </button>
                )}
                <button
                  className="link"
                  onClick={async () => {
                    await api.setCommentAnchor(blockId, subBlock.id, c.id, null);
                    await refresh();
                  }}
                >
                  Keep as general comment
                </button>
              </div>
            )}
            {replyingTo === c.id ? (
              <Composer
                placeholder="Reply…"
                submitLabel="Reply"
                onSubmit={async (text) => {
                  await api.addReply(blockId, subBlock.id, c.id, text);
                  setReplyingTo(null);
                  await refresh();
                }}
                onCancel={() => setReplyingTo(null)}
              />
            ) : (
              <button className="link comment-reply-btn" onClick={() => setReplyingTo(c.id)}>
                Reply
              </button>
            )}
          </article>
        );
      })}
      {props.composing !== undefined && (
        <article className="comment-thread new">
          {props.composing && <Quote anchor={props.composing} status={undefined} />}
          {user && (
            <div className="comment-meta">
              <Avatar name={user.name} username={user.username} size={26} />
              <div className="comment-who">
                <span className="comment-name">{user.name}</span>
                <span className="muted small">@{user.username}</span>
              </div>
            </div>
          )}
          <Composer
            key={JSON.stringify(props.composing)}
            placeholder={props.composing ? "Comment on the selection…" : "Comment on the whole sub-block…"}
            submitLabel="Comment"
            onSubmit={async (text) => {
              const created = await api.addComment(blockId, subBlock.id, text, props.composing);
              props.onCancelCompose();
              await refresh();
              if (created.anchor) bridge.setActive(created.id);
            }}
            onCancel={props.onCancelCompose}
          />
        </article>
      )}
    </aside>
  );
}
