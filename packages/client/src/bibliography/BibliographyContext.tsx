import type { BibEntry } from "@sourcebook/shared";
import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { BibEntryDialog } from "./BibEntryDialog";

export const bibliographyKey = ["bibliography"] as const;
export const bibUsagesKey = (key: string) => ["bibliography-usages", key] as const;

interface EditorState {
  /** Existing entry to edit; null for a new one. */
  entry: BibEntry | null;
  onCreated?(entry: BibEntry): void;
}

interface BibliographyValue {
  entries: BibEntry[];
  byKey: Map<string, BibEntry>;
  loaded: boolean;
  /** Opens the editor of an entry. */
  open(key: string): void;
  /** Opens the editor for a new entry; `onCreated` runs after it is saved. */
  create(onCreated?: (entry: BibEntry) => void): void;
}

const Ctx = createContext<BibliographyValue | null>(null);

/** Provides the project's bibliography and a single app-wide entry editor. */
export function BibliographyProvider({ children, onGoTo }: { children: ReactNode; onGoTo?(blockId: string): void }) {
  const { data, isSuccess } = useQuery({ queryKey: bibliographyKey, queryFn: api.getBibliography });
  const entries = useMemo(() => data ?? [], [data]);
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = useCallback((key: string) => {
    setOpenKey(key);
    setEditing(null);
  }, []);
  const create = useCallback((onCreated?: (entry: BibEntry) => void) => {
    setOpenKey(null);
    setEditing({ entry: null, onCreated });
  }, []);
  const value = useMemo(() => ({ entries, byKey, loaded: isSuccess, open, create }), [entries, byKey, isSuccess, open, create]);
  // An entry being edited follows its latest version (e.g. renamed by the assistant).
  const current = openKey ? (byKey.get(openKey) ?? null) : null;
  const close = () => {
    setOpenKey(null);
    setEditing(null);
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      <BibEntryDialog
        open={!!editing || (!!openKey && !!current)}
        entry={current}
        missingKey={openKey && isSuccess && !current ? openKey : undefined}
        onClose={close}
        onSaved={(saved, isNew) => {
          if (isNew) {
            editing?.onCreated?.(saved);
            close();
          } else setOpenKey(saved.key);
        }}
        onGoTo={
          onGoTo &&
          ((blockId) => {
            close();
            onGoTo(blockId);
          })
        }
      />
    </Ctx.Provider>
  );
}

export function useBibliography(): BibliographyValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBibliography must be used inside <BibliographyProvider>");
  return v;
}

/** The bibliography, or null outside a project editor (e.g. isolated component tests). */
export const useOptionalBibliography = () => useContext(Ctx);

/** "Knuth, D. E. · 1984" style one-line summary of authors and year. */
export function bibByline(e: BibEntry): string {
  const authors = (e.authors ?? "")
    .split(/\s+and\s+|;|\n/)
    .map((a) => a.trim())
    .filter(Boolean);
  const who = authors.length > 2 ? `${authors[0]} et al.` : authors.join(" & ");
  return [who, e.year].filter(Boolean).join(" · ");
}

/** Markdown for citing an entry in text. */
export const citationMarkdown = (e: Pick<BibEntry, "key" | "name">) => `[${e.name.replace(/([[\]])/g, "\\$1")}](bib:${e.key})`;
