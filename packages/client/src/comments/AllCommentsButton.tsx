import type { Project, ProjectCommentThread } from "@sourcebook/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api/client";
import { keys, useProjectComments } from "../api/queries";
import { useReadOnly } from "../auth/EditAccess";
import { Avatar } from "../components/Avatar";
import { PopoverMenu } from "../components/PopoverMenu";
import type { Target } from "../router";
import { registry } from "../subblocks";
import { outlineNumbers, withDepth } from "../tree";
import { DeleteButton } from "./CommentsPanel";
import { relativeTime } from "./time";

type Filter = "open" | "resolved" | "all";

/** Top-bar overview of every comment thread of the project, grouped by section; a click goes to the thread. */
export function AllCommentsButton({ project, goTo }: { project: Project | undefined; goTo(t: Target): void }) {
  const { data: threads = [] } = useProjectComments();
  const [filter, setFilter] = useState<Filter>("open");
  const numbers = useMemo(() => (project ? outlineNumbers(withDepth(project.blocks)) : new Map<string, string>()), [project]);
  const open = threads.filter((t) => !t.comment.resolution).length;
  const readOnly = useReadOnly();
  const qc = useQueryClient();
  const resolved = threads.filter((t) => t.comment.resolution);
  /** Deletes every resolved thread of the project (with access to write). */
  const deleteResolved = async () => {
    for (const t of resolved) await api.deleteComment(t.blockId, t.subBlockId, t.comment.id);
    await Promise.all([qc.invalidateQueries({ queryKey: keys.projectComments }), qc.invalidateQueries({ queryKey: ["comments"] }), qc.invalidateQueries({ queryKey: ["block"] })]);
  };
  const shown = threads.filter((t) => filter === "all" || (filter === "open") === !t.comment.resolution);
  const groups: { blockId: string; title: string; threads: ProjectCommentThread[] }[] = [];
  for (const t of shown) {
    const last = groups.at(-1);
    if (last?.blockId === t.blockId) last.threads.push(t);
    else groups.push({ blockId: t.blockId, title: t.sectionTitle, threads: [t] });
  }
  return (
    <PopoverMenu
      label="All comments"
      title={open ? `${open} open comment thread${open === 1 ? "" : "s"} in this project` : "All comments of this project"}
      className="allc-menu"
      icon={
        <span className="badge-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
            <path d="M8 10h8M8 14h5" />
          </svg>
          {open > 0 && <span className="topbar-badge">{open > 99 ? "99+" : open}</span>}
        </span>
      }
    >
      {(close) => (
        <>
          <div className="notif-menu-head">
            <span className="popover-title">Comments</span>
            <div className="seg" role="radiogroup" aria-label="Show">
              {(["open", "resolved", "all"] as const).map((f) => (
                <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? "on" : undefined} onClick={() => setFilter(f)}>
                  {f === "open" ? `Open (${open})` : f === "resolved" ? `Resolved (${threads.length - open})` : "All"}
                </button>
              ))}
            </div>
          </div>
          {filter === "resolved" && resolved.length > 0 && !readOnly && (
            <div className="allc-bulk">
              <DeleteButton
                what={`all ${resolved.length} resolved thread${resolved.length === 1 ? "" : "s"} of the project`}
                confirmLabel={`Delete ${resolved.length} resolved`}
                onDelete={deleteResolved}
              />
              <span className="muted small">Delete all resolved threads</span>
            </div>
          )}
          {groups.length === 0 ? (
            <p className="muted small notif-empty">{filter === "open" ? "No open comments — nothing left to handle." : "No comments."}</p>
          ) : (
            <div className="notif-list">
              {groups.map((g) => (
                <section key={g.blockId} className="allc-group">
                  <h3 className="allc-section">
                    §{numbers.get(g.blockId)} {g.title}
                  </h3>
                  {g.threads.map((t) => {
                    const c = t.comment;
                    const where = `#${t.subBlockIndex} ${t.subBlockTitle || registry.get(t.subBlockType)?.label || t.subBlockType}`;
                    return (
                      <button
                        key={c.id}
                        className={`allc-item${c.resolution ? " resolved" : ""}`}
                        onClick={() => {
                          close();
                          goTo({ sectionId: t.blockId, subBlockId: t.subBlockId, commentId: c.id });
                        }}
                      >
                        <span className="allc-meta">
                          <Avatar name={c.author.name} username={c.author.username} size={20} />
                          <span className="allc-who">
                            {c.author.name}
                            {c.author.onBehalfOf && <span className="author-for"> · for {c.author.onBehalfOf.name}</span>}
                          </span>
                          <span className="muted small">
                            {where} · {relativeTime(c.createdAt)}
                            {c.replies.length > 0 && ` · ${c.replies.length} repl${c.replies.length === 1 ? "y" : "ies"}`}
                          </span>
                          {c.resolution && <span className="comment-resolved-badge">✓</span>}
                        </span>
                        {c.anchor && <span className="allc-quote">“{c.anchor.exact.length > 80 ? `${c.anchor.exact.slice(0, 80)}…` : c.anchor.exact}”</span>}
                        <span className="allc-text">{c.text.length > 160 ? `${c.text.slice(0, 160)}…` : c.text}</span>
                      </button>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </PopoverMenu>
  );
}
