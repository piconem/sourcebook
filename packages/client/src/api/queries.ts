import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

export const keys = {
  project: ["project"] as const,
  block: (id: string) => ["block", id] as const,
  user: ["user"] as const,
  comments: (blockId: string, subBlockId: string) => ["comments", blockId, subBlockId] as const,
};

export const useProject = () => useQuery({ queryKey: keys.project, queryFn: api.getProject });

export const useBlock = (id: string | null) =>
  useQuery({ queryKey: keys.block(id ?? ""), queryFn: () => api.getBlock(id!), enabled: !!id });

export const useUser = () => useQuery({ queryKey: keys.user, queryFn: api.getUser, staleTime: Infinity });
