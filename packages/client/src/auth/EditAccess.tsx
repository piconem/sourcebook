import type { SubBlockLock } from "@sourcebook/shared";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { api } from "../api/client";
import { keys, useUser } from "../api/queries";
import { useAuth } from "./AuthContext";

/** The open project/template is read-only for the signed-in user (they can still comment). */
export const ReadOnlyContext = createContext(false);
export const useReadOnly = () => useContext(ReadOnlyContext);

/** Locked sub-blocks of the open project (refetched on live "locks" events). */
export const useLocks = () => useQuery({ queryKey: keys.locks, queryFn: api.getLocks });

/** The username that signs this user's actions (to recognize their own locks). */
export function useMyUsername(): string | undefined {
  const auth = useAuth();
  const { data: user } = useUser();
  return auth?.me.author.username ?? user?.username;
}

/** Who holds a sub-block and what the signed-in user may do about it. */
export function useSubBlockLock(subBlockId: string): { lock?: SubBlockLock; mine: boolean; canRelease: boolean; canForce: boolean } {
  const { data: locks = [] } = useLocks();
  const me = useMyUsername();
  const auth = useAuth();
  const lock = locks.find((l) => l.subBlockId === subBlockId);
  const mine = !!lock && lock.holder.username === me;
  const myAgent = !!lock && !!me && lock.holder.onBehalfOf?.username === me;
  const owner = auth?.me.user.role === "owner";
  return { lock, mine, canRelease: mine || myAgent, canForce: !!lock && !mine && !myAgent && owner };
}
