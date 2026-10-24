import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Author, SubBlockLock } from "@sourcebook/shared";
import { HttpError, notFound } from "../errors.js";
import { readJson, writeJsonAtomic } from "../fs/atomic.js";
import { Mutex } from "../fs/mutex.js";
import type { Principal } from "./AccountStore.js";
import type { NotebookStore } from "./NotebookStore.js";

export const LOCKS_FILE = "locks.json";

const who = (a: Author) => `${a.name}${a.onBehalfOf ? ` (agent of ${a.onBehalfOf.name})` : ""}`;

/**
 * Sub-blocks taken by a user or an agent (locks.json of the project): until the holder releases it, nobody else
 * may change or delete the sub-block (comments stay open). No expiry: the holder releases it, the user an agent
 * works for may release the agent's locks, and the owner of Sourcebook may release any.
 */
export class LockStore {
  private mutex = new Mutex();
  private readonly file: string;
  private locks: SubBlockLock[] | null = null;

  constructor(
    root: string,
    private readonly store: NotebookStore,
  ) {
    this.file = join(root, LOCKS_FILE);
  }

  private async load(): Promise<SubBlockLock[]> {
    if (!this.locks) {
      const raw = existsSync(this.file) ? ((await readJson(this.file).catch(() => null)) as { locks?: SubBlockLock[] } | null) : null;
      this.locks = raw?.locks ?? [];
    }
    return this.locks;
  }

  private async save() {
    await writeJsonAtomic(this.file, { version: 1, locks: this.locks });
    this.store.notify({ type: "locks" });
  }

  /** Current locks, dropping those of sub-blocks that no longer exist. */
  async list(): Promise<SubBlockLock[]> {
    return this.mutex.run(async () => {
      const locks = await this.load();
      const alive = locks.filter((l) => this.exists(l.blockId, l.subBlockId));
      if (alive.length !== locks.length) {
        this.locks = alive;
        await this.save();
      }
      return [...alive];
    });
  }

  private exists(blockId: string, subBlockId: string) {
    try {
      return this.store.getProject().blocks.some((b) => b.id === blockId && b.subBlocks.some((s) => s.id === subBlockId));
    } catch {
      return false;
    }
  }

  acquire(blockId: string, subBlockId: string, holder: Author): Promise<SubBlockLock> {
    return this.mutex.run(async () => {
      if (!this.exists(blockId, subBlockId)) throw notFound(`Sub-block ${subBlockId}`);
      const locks = await this.load();
      const current = locks.find((l) => l.subBlockId === subBlockId);
      if (current) {
        if (current.holder.username === holder.username) return current;
        throw new HttpError(409, `Locked by ${who(current.holder)} since ${current.since}`, { lock: current });
      }
      const lock: SubBlockLock = { blockId, subBlockId, holder, since: new Date().toISOString() };
      locks.push(lock);
      await this.save();
      return lock;
    });
  }

  /** Releases a lock: its holder, the user its agent works for, or (force) the owner. */
  release(subBlockId: string, principal: Principal, force = false): Promise<void> {
    return this.mutex.run(async () => {
      const locks = await this.load();
      const current = locks.find((l) => l.subBlockId === subBlockId);
      if (!current) return;
      const mine = current.holder.username === principal.author.username;
      const myAgent = !principal.agent && current.holder.onBehalfOf?.username === principal.user.username;
      if (!mine && !myAgent && !(force && principal.user.role === "owner")) {
        throw new HttpError(403, `Locked by ${who(current.holder)}: only they${principal.user.role === "owner" ? " (or you, with force)" : " or the owner of Sourcebook"} can release it`, {
          lock: current,
        });
      }
      this.locks = locks.filter((l) => l !== current);
      await this.save();
    });
  }

  /** Throws 423 if one of these sub-blocks is locked by someone other than `author`. */
  async assertFree(subBlockIds: string[], author: Author): Promise<void> {
    const locks = await this.mutex.run(() => this.load());
    const other = locks.find((l) => subBlockIds.includes(l.subBlockId) && l.holder.username !== author.username);
    if (other) throw new HttpError(423, `This sub-block is locked by ${who(other.holder)} since ${other.since}`, { lock: other });
  }

  /** Releases every lock held by `username` (`dryRun`: only counts). */
  async dropHolder(username: string, dryRun = false): Promise<number> {
    return this.mutex.run(async () => {
      const locks = await this.load();
      const kept = locks.filter((l) => l.holder.username !== username);
      if (kept.length !== locks.length && !dryRun) {
        this.locks = kept;
        await this.save();
      }
      return locks.length - kept.length;
    });
  }

  /** Forgets locks of deleted sub-blocks. */
  async drop(subBlockIds: string[]): Promise<void> {
    await this.mutex.run(async () => {
      const locks = await this.load();
      const kept = locks.filter((l) => !subBlockIds.includes(l.subBlockId));
      if (kept.length === locks.length) return;
      this.locks = kept;
      await this.save();
    });
  }
}
