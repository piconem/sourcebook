import type { ProjectSummary } from "@sourcebook/shared";
import { useEffect, useState } from "react";
import { api, ApiError, type TemplateImportPreview } from "../api/client";
import { Dialog } from "../components/Dialog";
import { formatSize } from "../references/ReferenceViewerDialog";

type State =
  | { step: "checking" }
  | { step: "invalid"; message: string; errors: string[]; warnings: string[] }
  | { step: "preview"; preview: TemplateImportPreview }
  | { step: "importing"; preview: TemplateImportPreview };

/**
 * Import flow for a template ZIP: the server validates the whole archive first (dry run); the user sees
 * either every problem found, or a preview (with an editable name) and confirms the import.
 */
export function ImportTemplateDialog(props: { file: File | null; onClose(): void; onImported(t: ProjectSummary): void }) {
  const [state, setState] = useState<State>({ step: "checking" });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.file) return;
    let cancelled = false;
    setState({ step: "checking" });
    setError(null);
    api
      .importTemplate(props.file, { dryRun: true })
      .then((preview) => {
        if (cancelled) return;
        setName(preview.name);
        setState({ step: "preview", preview });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const details = e instanceof ApiError ? (e.details as { errors?: string[]; warnings?: string[] } | undefined) : undefined;
        setState({ step: "invalid", message: (e as Error).message, errors: details?.errors ?? [], warnings: details?.warnings ?? [] });
      });
    return () => {
      cancelled = true;
    };
  }, [props.file]);

  const doImport = async () => {
    if (state.step !== "preview" || !props.file || !name.trim()) return;
    setState({ step: "importing", preview: state.preview });
    setError(null);
    try {
      props.onImported(await api.importTemplate(props.file, { dryRun: false, name: name.trim() }));
    } catch (e) {
      setError((e as Error).message);
      setState({ step: "preview", preview: state.preview });
    }
  };

  const file = props.file;
  const preview = state.step === "preview" || state.step === "importing" ? state.preview : null;
  return (
    <Dialog
      open={!!file}
      title="Import template"
      onClose={props.onClose}
      actions={
        state.step === "invalid" ? (
          <button className="primary" onClick={props.onClose}>
            Close
          </button>
        ) : (
          <>
            <button onClick={props.onClose}>Cancel</button>
            <button className="primary" disabled={!preview || state.step === "importing" || !name.trim()} onClick={doImport}>
              {state.step === "importing" ? "Importing…" : "Import"}
            </button>
          </>
        )
      }
    >
      {file && (
        <p className="muted small">
          {file.name} · {formatSize(file.size)}
        </p>
      )}
      {state.step === "checking" && <p className="muted">Checking the archive…</p>}

      {state.step === "invalid" && (
        <div className="import-invalid">
          <p className="render-error">
            <strong>This archive cannot be imported.</strong>{" "}
            {state.errors.length ? `${state.errors.length} problem${state.errors.length === 1 ? "" : "s"} found:` : state.message}
          </p>
          {state.errors.length > 0 && (
            <ul className="import-errors">
              {state.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <p className="muted small">Nothing was imported. Export templates from Sourcebook to get a valid archive.</p>
        </div>
      )}

      {preview && (
        <>
          <p className="import-ok">✓ The archive is a valid Sourcebook template.</p>
          <div className="form-grid">
            <label className="field">
              <span>Template name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doImport()} />
            </label>
          </div>
          {preview.description && <p className="muted small">{preview.description}</p>}
          <ul className="import-summary">
            <li>{preview.sections} section{preview.sections === 1 ? "" : "s"}</li>
            <li>{preview.subBlocks} sub-block{preview.subBlocks === 1 ? "" : "s"}</li>
            <li>{preview.references} reference file{preview.references === 1 ? "" : "s"}</li>
          </ul>
        </>
      )}
      {(preview?.warnings.length || (state.step === "invalid" && state.warnings.length)) ? (
        <details className="import-warnings" open={!!preview}>
          <summary>Notes ({(preview?.warnings ?? (state as { warnings: string[] }).warnings).length})</summary>
          <ul>
            {(preview?.warnings ?? (state as { warnings: string[] }).warnings).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {error && <p className="render-error">{error}</p>}
    </Dialog>
  );
}
