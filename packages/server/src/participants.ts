import type { AccountView, AgentView, Author, Participant } from "@sourcebook/shared";
import { HttpError } from "./errors.js";
import type { NotebookStore } from "./store/NotebookStore.js";
import type { NotificationStore } from "./store/NotificationStore.js";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Everyone who signed something in the project (newest activity first). With accounts, the users who may open
 * the project and their agents are listed too (registered identities); in single-user mode, the local user.
 */
export async function listParticipants(
  nb: { store: NotebookStore; notifications: NotificationStore },
  people: { local?: AccountView; users?: AccountView[]; agents?: AgentView[] },
): Promise<Participant[]> {
  const byUsername = new Map<string, Participant>();
  const add = (author: Author, at: string) => {
    const p = byUsername.get(author.username);
    if (!p) {
      byUsername.set(author.username, {
        username: author.username,
        name: author.name,
        kind: author.kind === "assistant" ? "assistant" : "user",
        ...(author.onBehalfOf ? { onBehalfOf: author.onBehalfOf } : {}),
        contributions: 1,
        lastActive: at,
      });
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
  for (const n of await nb.notifications.list("")) add(n.author, n.createdAt);

  const register = (p: Omit<Participant, "contributions" | "lastActive">) => {
    const seen = byUsername.get(p.username);
    byUsername.set(p.username, { ...(seen ?? { contributions: 0 }), ...p });
  };
  for (const u of people.users ?? []) register({ username: u.username, name: u.name, kind: "user", registered: true });
  for (const a of people.agents ?? []) {
    if (!a.revoked) register({ username: a.id, name: a.name, kind: "assistant", onBehalfOf: { username: a.owner, name: a.ownerName }, registered: true });
  }
  if (people.local) register({ username: people.local.username, name: people.local.name, kind: "user", local: true });
  return [...byUsername.values()].sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? "") || a.username.localeCompare(b.username));
}

/**
 * Single-user mode: refuses an explicitly given author that would be mistaken for someone else in the project —
 * the local user's username used by an agent, an id already used with another name, or a name already used by
 * another id. (With accounts, identities come from sessions and agent tokens and are unique by construction.)
 */
export async function checkAuthor(nb: { store: NotebookStore; notifications: NotificationStore }, local: AccountView, author: Author): Promise<void> {
  if (author.username === local.username) {
    if (author.kind !== "assistant" && same(author.name, local.name)) return;
    throw new HttpError(409, `The id "${author.username}" belongs to the local user ${local.name}: choose another agent id (see list_participants).`);
  }
  const participants = await listParticipants(nb, { local });
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
