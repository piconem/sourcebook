import type { ReferenceNode } from "@sourcebook/shared";
import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { ReferenceViewerDialog } from "./ReferenceViewerDialog";

export const referencesKey = ["references"] as const;

interface ReferencesValue {
  tree: ReferenceNode | undefined;
  /** All files, flattened, in tree order. */
  files: ReferenceNode[];
  open(path: string): void;
}

/** The references, or null outside a project editor. */
export const ReferencesContext = createContext<ReferencesValue | null>(null);
const Ctx = ReferencesContext;

export function flattenFiles(node: ReferenceNode | undefined): ReferenceNode[] {
  if (!node) return [];
  return node.kind === "file" ? [node] : (node.children ?? []).flatMap(flattenFiles);
}

/** Provides the references tree and a single app-wide viewer dialog. */
export function ReferencesProvider({ children }: { children: ReactNode }) {
  const { data: tree } = useQuery({ queryKey: referencesKey, queryFn: api.getReferences });
  const [openPath, setOpenPath] = useState<string | null>(null);
  const files = useMemo(() => flattenFiles(tree), [tree]);
  const open = useCallback((path: string) => setOpenPath(path), []);
  const node = openPath ? (files.find((f) => f.path === openPath) ?? { name: openPath.split("/").pop()!, path: openPath, kind: "file" as const }) : null;
  const value = useMemo(() => ({ tree, files, open }), [tree, files, open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <ReferenceViewerDialog node={node} missing={!!openPath && !files.some((f) => f.path === openPath)} onClose={() => setOpenPath(null)} />
    </Ctx.Provider>
  );
}

export function useReferences(): ReferencesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useReferences must be used inside <ReferencesProvider>");
  return v;
}
