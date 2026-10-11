import type { Notification, NotificationTarget, Project } from "@sourcebook/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { keys, useNotifications } from "../api/queries";
import { Avatar } from "../components/Avatar";
import { PopoverMenu } from "../components/PopoverMenu";
import { fullTime, relativeTime } from "../comments/time";
import type { Target } from "../router";
import { targetLabel } from "./labels";

export const BellIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

const toTarget = (t: NotificationTarget): Target => ({
  sectionId: t.blockId,
  ...(t.subBlockId ? { subBlockId: t.subBlockId } : {}),
  ...(t.commentId ? { commentId: t.commentId } : {}),
});

/** One notification: author, time, summary and the parts involved (each a link). */
export function NotificationItem(props: {
  n: Notification;
  project: Project | undefined;
  onOpen(target: Target | null): void;
  onMarkRead?(): void;
}) {
  const { n, project } = props;
  return (
    <div className={`notif-item${n.read ? " read" : ""}`}>
      <div className="notif-head">
        <Avatar name={n.author.name} username={n.author.username} size={24} />
        <span className="notif-who">
          {n.author.name}
          {n.author.kind === "assistant" && <span className="badge-ai" title="Sent by an AI assistant">AI</span>}
        </span>
        <time className="muted small" dateTime={n.createdAt} title={fullTime(n.createdAt)}>
          {relativeTime(n.createdAt)}
        </time>
        {!n.read && <span className="notif-dot" aria-label="Unread" />}
      </div>
      <button className="notif-summary" onClick={() => props.onOpen(n.targets[0] ? toTarget(n.targets[0]) : null)}>
        {n.summary}
      </button>
      {n.targets.length > 0 && (
        <ul className="notif-targets">
          {n.targets.map((t, i) => {
            const { label, exists } = targetLabel(project, t);
            return (
              <li key={i}>
                {exists ? (
                  <button className="link" onClick={() => props.onOpen(toTarget(t))} title="Go there">
                    {label}
                  </button>
                ) : (
                  <span className="muted" title="No longer exists">
                    {label} (deleted)
                  </span>
                )}
                {t.note && <span className="muted small"> — {t.note}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {!n.read && props.onMarkRead && (
        <button className="link small notif-mark" onClick={props.onMarkRead}>
          Mark as read
        </button>
      )}
    </div>
  );
}

/**
 * Top-bar menu of change notifications sent by external applications / assistants. The badge counts unread
 * ones; opening one marks it read and goes to the part it is about. Read ones stay until "Clear".
 */
export function NotificationsButton({ project, goTo }: { project: Project | undefined; goTo(t: Target): void }) {
  const qc = useQueryClient();
  const { data: list = [] } = useNotifications();
  const [confirmClear, setConfirmClear] = useState(false);
  const unread = list.filter((n) => !n.read).length;
  const update = (next: Notification[]) => qc.setQueryData(keys.notifications, next);
  const markRead = async (n: Notification) => !n.read && update(await api.markNotificationRead(n.id));
  return (
    <PopoverMenu
      label="Notifications"
      title={unread ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "Notifications"}
      className="notif-menu"
      icon={
        <span className="badge-wrap">
          <BellIcon />
          {unread > 0 && <span className="topbar-badge">{unread > 99 ? "99+" : unread}</span>}
        </span>
      }
    >
      {(close) => (
        <>
          <div className="notif-menu-head">
            <span className="popover-title">Notifications</span>
            <button className="link small" disabled={!unread} onClick={async () => update(await api.markAllNotificationsRead())}>
              Mark all as read
            </button>
            {confirmClear ? (
              <span className="small">
                <button
                  className="link danger"
                  onClick={async () => {
                    await api.clearNotifications();
                    update([]);
                    setConfirmClear(false);
                  }}
                >
                  Clear all
                </button>{" "}
                <button className="link" onClick={() => setConfirmClear(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button className="link small" disabled={!list.length} onClick={() => setConfirmClear(true)}>
                Clear
              </button>
            )}
          </div>
          {list.length === 0 ? (
            <p className="muted small notif-empty">No notifications. Applications and assistants can send them (REST API or MCP) when they change this project.</p>
          ) : (
            <div className="notif-list">
              {list.map((n) => (
                <NotificationItem
                  key={n.id}
                  n={n}
                  project={project}
                  onMarkRead={() => void markRead(n)}
                  onOpen={(t) => {
                    void markRead(n);
                    if (t) {
                      close();
                      goTo(t);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </PopoverMenu>
  );
}
