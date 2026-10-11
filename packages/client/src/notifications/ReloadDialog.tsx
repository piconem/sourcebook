import type { NotebookEvent, Project } from "@sourcebook/shared";
import { useState } from "react";
import { useNotifications } from "../api/queries";
import { Dialog } from "../components/Dialog";
import { flushAllSaves } from "../components/useDebouncedSaver";
import { originLabel } from "../live/externalChanges";
import type { Target } from "../router";
import { NotificationItem } from "./NotificationsButton";

/** Shown when an application / assistant asks open editors to reload after a group of changes. */
export function ReloadDialog(props: { request: NotebookEvent | null; project: Project | undefined; onClose(): void; goTo(t: Target): void }) {
  const { request } = props;
  const { data: list = [] } = useNotifications();
  const [reloading, setReloading] = useState(false);
  const ids = new Set(request?.notificationIds ?? []);
  const related = list.filter((n) => ids.has(n.id));
  const who = request?.author?.name ?? originLabel(request?.origin);
  return (
    <Dialog
      open={!!request}
      title="Changes made elsewhere"
      onClose={props.onClose}
      actions={
        <>
          <button onClick={props.onClose}>Later</button>
          <button
            className="primary"
            disabled={reloading}
            onClick={async () => {
              setReloading(true);
              await flushAllSaves();
              window.location.reload();
            }}
          >
            {reloading ? "Saving…" : "Reload now"}
          </button>
        </>
      }
    >
      <p>
        <strong>{who}</strong> changed this project and asks to reload the page, so that you see the latest version of
        everything. Your unsaved edits are saved first.
      </p>
      {request?.message && <blockquote className="reload-message">{request.message}</blockquote>}
      {related.length > 0 && (
        <>
          <p className="muted small">What changed:</p>
          <div className="notif-list in-dialog">
            {related.map((n) => (
              <NotificationItem
                key={n.id}
                n={n}
                project={props.project}
                onOpen={(t) => {
                  if (!t) return;
                  props.onClose();
                  props.goTo(t);
                }}
              />
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}
