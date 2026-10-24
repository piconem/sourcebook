import type { Notification } from "@sourcebook/shared";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { keys, useNotifications } from "../api/queries";
import { BellIcon } from "./NotificationsButton";

/**
 * Bell on a section or sub-block that unread notifications are about (a sub-block also counts the notifications
 * about its comments; a section only those about the section as a whole). Clicking marks them read.
 */
export function NotificationBadge({ blockId, subBlockId }: { blockId: string; subBlockId: string | null }) {
  const qc = useQueryClient();
  const { data: list = [] } = useNotifications();
  const hits: { n: Notification; note?: string }[] = [];
  for (const n of list) {
    if (n.read) continue;
    const t = n.targets.find((t) => t.blockId === blockId && (subBlockId ? t.subBlockId === subBlockId : !t.subBlockId));
    if (t) hits.push({ n, note: t.note });
  }
  if (!hits.length) return null;
  const markRead = async () => {
    for (const { n } of hits) qc.setQueryData(keys.notifications, await api.markNotificationRead(n.id));
  };
  const what = subBlockId ? "this sub-block" : "this section";
  return (
    <button
      className="notif-badge"
      title={`Changed — ${hits.length} unread notification${hits.length === 1 ? "" : "s"} about ${what}:\n${hits
        .map(({ n, note }) => `• ${n.author.name}: ${n.summary}${note ? ` — ${note}` : ""}`)
        .join("\n")}\nClick to mark as read`}
      aria-label={`${hits.length} unread notification${hits.length === 1 ? "" : "s"} about ${what} — mark as read`}
      onClick={() => void markRead()}
    >
      <BellIcon />
      {hits.length > 1 && <span>{hits.length}</span>}
    </button>
  );
}
