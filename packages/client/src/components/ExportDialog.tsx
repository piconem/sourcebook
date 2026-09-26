import { useEffect, useState } from "react";
import { api } from "../api/client";
import { CodeMirror } from "./CodeMirror";
import { Dialog } from "./Dialog";

type Exported = Awaited<ReturnType<typeof api.getExport>>;

interface SaveFilePickerWindow {
  showSaveFilePicker?(opts: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }): Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
}

/**
 * Asks where to save (File System Access API) and writes the archive there. Browsers without the
 * API (Firefox, Safari) fall back to a regular download.
 */
async function saveZip(suggestedName: string): Promise<"saved" | "downloaded" | "cancelled"> {
  const w = window as unknown as SaveFilePickerWindow;
  if (w.showSaveFilePicker) {
    let handle;
    try {
      // Must be called first, while the click's user activation is still valid.
      handle = await w.showSaveFilePicker({
        suggestedName,
        types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
      throw e;
    }
    const writable = await handle.createWritable();
    await writable.write(await api.getExportZip());
    await writable.close();
    return "saved";
  }
  const url = URL.createObjectURL(await api.getExportZip());
  const a = Object.assign(document.createElement("a"), { href: url, download: suggestedName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}

export function ExportDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [data, setData] = useState<Exported | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setError(null);
    setStatus(null);
    api.getExport().then(setData, (e: Error) => setError(e.message));
  }, [open]);

  const zipName = data ? data.fileName.replace(/\.md$/, ".zip") : "export.zip";

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await saveZip(zipName);
      setStatus(
        result === "saved"
          ? `Saved ${zipName}.`
          : result === "downloaded"
            ? `This browser cannot ask for a location: ${zipName} was saved to your downloads folder.`
            : null,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      wide
      title="Export combined Markdown"
      onClose={onClose}
      actions={
        <>
          {status && <span className="muted small">{status}</span>}
          <button onClick={onClose}>Close</button>
          <button className="primary" disabled={!data || busy} onClick={save}>
            {busy ? "Saving…" : `Save ${zipName}…`}
          </button>
        </>
      }
    >
      <p>
        The whole notebook is compiled into a single Markdown document. Images and diagram exports are linked
        with <strong>paths relative to the project folder</strong>, so the document alone would show broken
        images once moved elsewhere. For this reason the export is a <strong>ZIP archive</strong> containing the
        document plus every referenced file, in the same folder structure: extract it anywhere and all links keep
        working.
      </p>
      {error && <p className="render-error">{error}</p>}
      {!data && !error && <p className="muted">Compiling…</p>}
      {data && (
        <>
          <details className="export-files">
            <summary>
              Archive content: {data.fileName} + {data.files.length} referenced file{data.files.length === 1 ? "" : "s"}
            </summary>
            <ul className="file-list">
              <li>{data.fileName}</li>
              {data.files.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </details>
          <CodeMirror initialValue={data.markdown} ext="md" readOnly maxHeight="55vh" />
        </>
      )}
    </Dialog>
  );
}
