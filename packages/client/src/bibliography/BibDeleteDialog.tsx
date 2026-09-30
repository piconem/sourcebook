import type { BibEntry } from "@sourcebook/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { keys } from "../api/queries";
import { Dialog } from "../components/Dialog";
import { bibUsagesKey, bibliographyKey } from "./BibliographyContext";

/** Confirms deleting a source, listing where it is used (associations are removed; text links stay, flagged). */
export function BibDeleteDialog({ entry, onClose, onDeleted }: { entry: BibEntry | null; onClose(): void; onDeleted?(): void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const usages = useQuery({ queryKey: bibUsagesKey(entry?.key ?? ""), queryFn: () => api.getBibUsages(entry!.key), enabled: !!entry });
  const list = usages.data ?? [];
  const inText = list.filter((u) => u.kind === "text").length;
  const remove = async () => {
    if (!entry) return;
    try {
      await api.deleteBibEntry(entry.key, list.length > 0);
      setError(null);
      qc.setQueryData<BibEntry[]>(bibliographyKey, (l) => l?.filter((e) => e.key !== entry.key));
      void qc.invalidateQueries({ queryKey: bibliographyKey });
      if (list.some((u) => u.kind !== "text")) {
        void qc.invalidateQueries({ queryKey: ["block"] });
        void qc.invalidateQueries({ queryKey: keys.project });
      }
      onClose();
      onDeleted?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog
      open={!!entry}
      title={`Delete “${entry?.name ?? ""}”`}
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="danger solid" disabled={usages.isLoading} onClick={remove}>
            {list.length ? "Delete and remove associations" : "Delete"}
          </button>
        </>
      }
    >
      {usages.isLoading ? (
        <p className="muted">Checking where it is used…</p>
      ) : list.length === 0 ? (
        <p>
          <code>bib:{entry?.key}</code> is not used anywhere in the document.
        </p>
      ) : (
        <>
          <p>This source is used in {list.length} place(s):</p>
          <ul className="file-list">
            {list.map((u, i) => (
              <li key={i}>
                {u.ref} {u.title} — {u.kind === "text" ? "cited in the text" : `associated with the ${u.kind === "section" ? "section" : "sub-block"}`}
              </li>
            ))}
          </ul>
          <p className="muted small">
            Associations are removed.{inText > 0 && " Citations in the text stay as links and are marked as missing until you edit them."}
          </p>
        </>
      )}
      {error && <p className="render-error">{error}</p>}
    </Dialog>
  );
}
