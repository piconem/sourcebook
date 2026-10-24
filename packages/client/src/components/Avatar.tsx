import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { useContext, useState } from "react";
import { api, avatarUrl } from "../api/client";

/** Initials in a colored circle; the hue is derived from the username so each person keeps a color. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

export function hueOf(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

export const avatarsKey = ["avatars"] as const;
/** Used when a component is rendered without a query client (some tests): no pictures, initials only. */
const noClient = new QueryClient();

/** Pictures of users and agents: id → version. */
export function useAvatars(): Record<string, number> {
  const client = useContext(QueryClientContext);
  const { data } = useQuery({ queryKey: avatarsKey, queryFn: api.getAvatars, staleTime: 5 * 60_000, retry: false, enabled: !!client }, client ?? noClient);
  return data ?? {};
}

/** The person's (or agent's) picture in a circle, or their initials when they have none. */
export function Avatar({ name, username, size = 28 }: { name: string; username: string; size?: number }) {
  const version = useAvatars()[username];
  const [broken, setBroken] = useState<number | null>(null);
  const picture = version !== undefined && broken !== version;
  return (
    <span
      className={`avatar${picture ? " has-picture" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hueOf(username)} 55% 45%)` }}
      aria-hidden="true"
    >
      {picture ? <img src={avatarUrl(username, version)} alt="" draggable={false} onError={() => setBroken(version)} /> : initials(name)}
    </span>
  );
}
