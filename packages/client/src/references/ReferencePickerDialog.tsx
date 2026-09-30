import type { ReferenceNode } from "@sourcebook/shared";
import { useEffect, useState } from "react";
import { Dialog } from "../components/Dialog";
import { useReferences } from "./ReferencesContext";
import { formatSize } from "./ReferenceViewerDialog";
import { viewerFor } from "./viewers";

/** Choose a reference file (filterable flat list with folder paths). */
export function ReferencePickerDialog({ open, onPick, onClose, title = "Link a reference" }: { open: boolean; onPick(node: ReferenceNode): void; onClose(): void; title?: string }) {
  const { files } = useReferences();
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open) setQ("");
  }, [open]);
  const shown = files.filter((f) => f.path.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog open={open} title={title} onClose={onClose} actions={<button onClick={onClose}>Cancel</button>}>
      {files.length === 0 ? (
        <p className="muted">No references yet. Add files from the References panel in the sidebar.</p>
      ) : (
        <>
          <input className="bib-search" autoFocus placeholder={`Filter ${files.length} files…`} value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="ref-pick">
            {shown.map((f) => (
              <li key={f.path}>
                <button type="button" onClick={() => onPick(f)}>
                  <span aria-hidden="true">{viewerFor(f.name)?.icon ?? "📦"}</span>
                  <span className="ref-pick-name">{f.name}</span>
                  <span className="muted small">
                    {f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : ""} {formatSize(f.size)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">
            The link text is the selected text, or the file name. Ctrl/⌘ + click a link in the editor to open the file.
          </p>
        </>
      )}
    </Dialog>
  );
}
