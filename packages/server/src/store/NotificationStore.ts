import { existsSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import {
  NotificationsFileSchema,
  outlineNumbers,
  withDepth,
  type Author,
  type ChangeTarget,
  type Notification,
  type NotificationTarget,
} from "@sourcebook/shared";
import { badRequest, notFound } from "../errors.js";
import { readJson, writeJsonAtomic } from "../fs/atomic.js";
import { Mutex } from "../fs/mutex.js";
import type { NotebookStore } from "./NotebookStore.js";

export const NOTIFICATIONS_FILE = "notifications.json";
/** Older notifications are dropped beyond this. */
export const MAX_NOTIFICATIONS = 200;

/**
 * Change notifications sent by external applications or assistants ("I changed §2.1 and its comments"),
 * kept in the project's notifications.json (newest first) with their read state. They are not content:
 * copies, templates and archives leave them out.
 */
export class NotificationStore {
  private mutex = new Mutex();
  private readonly file: string;

  constructor(
    root: string,
    private readonly store: NotebookStore,
  ) {
    this.file = join(root, NOTIFICATIONS_FILE);
  }

  private async read(): Promise<Notification[]> {
    if (!existsSync(this.file)) return [];
    const parsed = NotificationsFileSchema.safeParse(await readJson(this.file).catch(() => null));
    return parsed.success ? parsed.data.notifications : [];
  }

  private write(list: Notification[]) {
    return writeJsonAtomic(this.file, { version: 1, notifications: list.slice(0, MAX_NOTIFICATIONS) });
  }

  list(): Promise<Notification[]> {
    return this.read();
  }

  /** Checks every target exists and records its current label ("§2.1 Title", "§2.1#3 Markdown", …). */
  private async labelled(targets: ChangeTarget[]): Promise<NotificationTarget[]> {
    const project = this.store.getProject();
    const numbers = outlineNumbers(withDepth(project.blocks));
    const out: NotificationTarget[] = [];
    for (const [i, t] of targets.entries()) {
      const where = `targets[${i}]`;
      const section = project.blocks.find((b) => b.id === t.blockId);
      if (!section) throw badRequest(`${where}: section ${t.blockId} does not exist`);
      const n = `§${numbers.get(section.id)}`;
      let label = `${n} ${section.title}`;
      if (t.subBlockId) {
        const index = section.subBlocks.findIndex((s) => s.id === t.subBlockId);
        if (index < 0) throw badRequest(`${where}: sub-block ${t.subBlockId} is not in section ${n}`);
        const sub = section.subBlocks[index];
        label = `${n}#${index + 1} ${sub.title || this.store.registry.get(sub.type)?.label || sub.type}`;
        if (t.commentId) {
          const comments = await this.store.listComments(section.id, sub.id);
          if (!comments.some((c) => c.id === t.commentId)) throw badRequest(`${where}: comment ${t.commentId} is not on ${n}#${index + 1}`);
          label = `Comment on ${label}`;
        }
      }
      out.push({ ...t, label });
    }
    return out;
  }

  add(author: Author, summary: string, targets: ChangeTarget[]): Promise<Notification> {
    return this.mutex.run(async () => {
      const n: Notification = {
        id: nanoid(10),
        createdAt: new Date().toISOString(),
        author,
        summary,
        targets: await this.labelled(targets),
        read: false,
      };
      await this.write([n, ...(await this.read())]);
      this.store.notify({ type: "notifications" });
      return n;
    });
  }

  /** Marks one notification (or, without id, all of them) as read. */
  markRead(id?: string): Promise<Notification[]> {
    return this.mutex.run(async () => {
      const list = await this.read();
      if (id && !list.some((n) => n.id === id)) throw notFound(`Notification ${id}`);
      for (const n of list) if (!id || n.id === id) n.read = true;
      await this.write(list);
      this.store.notify({ type: "notifications" });
      return list;
    });
  }

  /** Removes every notification. */
  clear(): Promise<void> {
    return this.mutex.run(async () => {
      await this.write([]);
      this.store.notify({ type: "notifications" });
    });
  }

  /** Asks open editors to reload; the notifications describing the changes default to the unread ones. */
  async requestReload(author: Author, message?: string, notificationIds?: string[]): Promise<{ notificationIds: string[] }> {
    const list = await this.read();
    const ids = notificationIds ?? list.filter((n) => !n.read).map((n) => n.id);
    const unknown = ids.filter((id) => !list.some((n) => n.id === id));
    if (unknown.length) throw badRequest(`Unknown notifications: ${unknown.join(", ")}`);
    this.store.notify({ type: "reload", author, ...(message ? { message } : {}), notificationIds: ids });
    return { notificationIds: ids };
  }
}
