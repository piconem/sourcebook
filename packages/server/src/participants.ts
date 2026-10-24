import type { Author, Participant, UserProfile } from "@sourcebook/shared";
import { HttpError } from "./errors.js";
import type { NotebookStore } from "./store/NotebookStore.js";
import type { NotificationStore } from "./store/NotificationStore.js";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Everyone who signed something in the project (newest activity first), plus the local user. */
export async function listParticipants(nb: { store: NotebookStore; notifications: NotificationStore }, local: UserProfile): Promise<Participant[]> {
  const byUsername = new Map<string, Participant>();
  const add = (author: Author, at: string) => {
    const p = byUsername.get(author.username);
    if (!p) {
      byUsername.set(author.username, { username: author.username, name: author.name, kind: author.kind === "assistant" ? "assistant" : "user", contributions: 1, lastActive: at });
      return;
    }
    p.contributions++;
    if (!p.lastActive || at > p.lastActive) {
      p.lastActive = at;
      p.name = author.name; // the latest name wins
    }
    if (author.kind === "assistant") p.kind = "assistant";
  };
  for (const { comment } of await nb.store.listProjectComments("all")) {
    add(comment.author, comment.createdAt);
    for (const r of comment.replies) add(r.author, r.createdAt);
    if (comment.resolution) add(comment.resolution.by, comment.resolution.at);
  }
  for (const n of await nb.notifications.list()) add(n.author, n.createdAt);

  const me = byUsername.get(local.username);
  byUsername.set(local.username, { ...(me ?? { contributions: 0 }), username: local.username, name: local.name, kind: "user", local: true });
  return [...byUsername.values()].sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? "") || a.username.localeCompare(b.username));
}

/**
 * Refuses an explicitly given author that would be mistaken for someone else in the project: the local user's
 * username used by an agent, an id already used with another name, or a name already used by another id.
 * The same id with the same name is the same agent continuing its work.
 */
export async function checkAuthor(nb: { store: NotebookStore; notifications: NotificationStore }, local: UserProfile, author: Author): Promise<void> {
  if (author.username === local.username) {
    if (author.kind !== "assistant" && same(author.name, local.name)) return;
    throw new HttpError(409, `The id "${author.username}" belongs to the local user ${local.name}: choose another agent id (see list_participants).`);
  }
  const participants = await listParticipants(nb, local);
  const sameId = participants.find((p) => p.username === author.username);
  if (sameId && !same(sameId.name, author.name)) {
    throw new HttpError(409, `The id "${author.username}" is already used by "${sameId.name}" in this project: use that name, or choose another id (see list_participants).`, {
      participant: sameId,
    });
  }
  const sameName = participants.find((p) => p.username !== author.username && same(p.name, author.name));
  if (sameName) {
    throw new HttpError(409, `The name "${author.name}" is already used by @${sameName.username} in this project: choose another name (see list_participants).`, {
      participant: sameName,
    });
  }
}
