import type { SubBlockLock } from "@sourcebook/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { keys } from "../api/queries";
import { relativeTime } from "../comments/time";

const holderLabel = (l: SubBlockLock) => `${l.holder.name}${l.holder.onBehalfOf ? ` (agent of ${l.holder.onBehalfOf.name})` : ""}`;

const LockIcon = ({ open }: { open?: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d={open ? "M8 11V7a4 4 0 0 1 7.5-2" : "M8 11V7a4 4 0 0 1 8 0v4"} />
  </svg>
);

/**
 * Take / release a sub-block. While someone else holds it, shows who (the editor is frozen); the user an agent
 * works for may release the agent's lock, the owner may force any.
 */
export function LockButton(props: {
  blockId: string;
  subBlockId: string;
  state: { lock?: SubBlockLock; mine: boolean; canRelease: boolean; canForce: boolean };
  /** Saves pending edits before releasing. */
  beforeRelease?(): Promise<void>;
}) {
  const qc = useQueryClient();
  const { lock, mine, canRelease, canForce } = props.state;
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await qc.invalidateQueries({ queryKey: keys.locks });
    }
  };
  const take = () => act(() => api.lockSubBlock(props.blockId, props.subBlockId));
  const release = (force = false) =>
    act(async () => {
      await props.beforeRelease?.();
      await api.unlockSubBlock(props.blockId, props.subBlockId, force);
    });

  if (!lock) {
    return (
      <button className="icon lock-btn" title={error ?? "Take this sub-block: nobody else can change it until you release it"} aria-label="Lock" onClick={take}>
        <LockIcon open />
      </button>
    );
  }
  if (mine) {
    return (
      <button className="lock-btn mine" title={`You hold this sub-block since ${relativeTime(lock.since)}: release it when you are done`} onClick={() => release()}>
        <LockIcon /> Release
      </button>
    );
  }
  return (
    <span className="lock-badge" title={`Locked by ${holderLabel(lock)} ${relativeTime(lock.since)}: it cannot be changed until they release it${error ? ` — ${error}` : ""}`}>
      <LockIcon /> {lock.holder.name}
      {(canRelease || canForce) && (
        <button className="link small" onClick={() => release(canForce)} title={canForce ? "Release it (owner)" : "Release your agent's lock"}>
          Unlock
        </button>
      )}
    </span>
  );
}
