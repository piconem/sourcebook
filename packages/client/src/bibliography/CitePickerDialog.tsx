import type { BibEntry } from "@sourcebook/shared";
import { useEffect, useState } from "react";
import { Dialog } from "../components/Dialog";
import { bibByline, useBibliography } from "./BibliographyContext";

/** Matches an entry against a search (name, authors, title, year, key). */
export const bibMatches = (e: BibEntry, q: string) =>
  !q.trim() || [e.key, e.name, e.authors, e.title, e.year, e.venue].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase()));

/** Choose a source to cite (or create one). */
export function CitePickerDialog({ open, onPick, onClose, title = "Cite a source" }: { open: boolean; onPick(entry: BibEntry): void; onClose(): void; title?: string }) {
  const { entries, create } = useBibliography();
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open) setQ("");
  }, [open]);
  const shown = entries.filter((e) => bibMatches(e, q));
  const createNew = () => {
    onClose();
    create(onPick);
  };
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      actions={
        <>
          <button onClick={createNew}>＋ New source…</button>
          <button onClick={onClose}>Cancel</button>
        </>
      }
    >
      {entries.length === 0 ? (
        <p className="muted">The bibliography is empty. Create a source (you can paste its BibTeX) and it is cited right away.</p>
      ) : (
        <>
          <input
            className="bib-search"
            autoFocus
            placeholder={`Search ${entries.length} sources by name, author, title, year…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && shown[0] && onPick(shown[0])}
          />
          <ul className="ref-pick bibl-pick">
            {shown.map((e) => (
              <li key={e.key}>
                <button type="button" onClick={() => onPick(e)}>
                  <span className="bibl-pick-main">
                    <strong>{e.name}</strong> <span className="muted small">{bibByline(e)}</span>
                    {e.title && <span className="bibl-pick-title">{e.title}</span>}
                  </span>
                  <code className="bibl-key">{e.key}</code>
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="muted small">No sources match — create a new one.</li>}
          </ul>
          <p className="muted small">
            Inserts a link <code>[Name](bib:key)</code> on the selected text, or the source name. Ctrl/⌘ + click a citation to open the source.
          </p>
        </>
      )}
    </Dialog>
  );
}
