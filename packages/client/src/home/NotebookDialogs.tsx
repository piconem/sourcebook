import type { NotebookKind, ProjectSummary } from "@sourcebook/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Dialog } from "../components/Dialog";

export const notebooksKey = (kind: NotebookKind) => ["notebooks", kind] as const;
export const kindLabel = (kind: NotebookKind, plural = false) =>
  kind === "projects" ? (plural ? "Projects" : "Project") : plural ? "Templates" : "Template";

export interface NotebookForm {
  name: string;
  description: string;
  /** "kind/id" of the source to copy, or "" for blank. */
  from: string;
}

/** Create (with an optional source to copy) or edit name/description of a project or template. */
export function NotebookFormDialog(props: {
  open: boolean;
  mode: "create" | "edit";
  kind: NotebookKind;
  initial: NotebookForm;
  onSubmit(form: NotebookForm): Promise<void>;
  onClose(): void;
}) {
  const [form, setForm] = useState(props.initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const templates = useQuery({ queryKey: notebooksKey("templates"), queryFn: () => api.listNotebooks("templates"), enabled: props.open && props.mode === "create" });
  const projects = useQuery({
    queryKey: notebooksKey("projects"),
    queryFn: () => api.listNotebooks("projects"),
    enabled: props.open && props.mode === "create" && props.kind === "templates",
  });

  useEffect(() => {
    if (!props.open) return;
    setForm(props.initial);
    setError(null);
    requestAnimationFrame(() => nameInput.current?.select());
  }, [props.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!form.name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await props.onSubmit({ ...form, name: form.name.trim() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const noun = kindLabel(props.kind).toLowerCase();
  const option = (s: ProjectSummary) => (
    <option key={`${s.kind}/${s.id}`} value={`${s.kind}/${s.id}`}>
      {s.name} ({s.sections} section{s.sections === 1 ? "" : "s"})
    </option>
  );
  return (
    <Dialog
      open={props.open}
      title={props.mode === "create" ? `New ${noun}` : `Edit ${noun}`}
      onClose={props.onClose}
      actions={
        <>
          <button onClick={props.onClose}>Cancel</button>
          <button className="primary" disabled={!form.name.trim() || busy} onClick={submit}>
            {busy ? "Saving…" : props.mode === "create" ? "Create" : "Save"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input ref={nameInput} value={form.name} placeholder={props.kind === "projects" ? "Payment service" : "Design document"} onChange={(e) => setForm({ ...form, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea rows={2} value={form.description} placeholder="Optional" onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        {props.mode === "create" && (
          <label className="field">
            <span>Start from</span>
            <select value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>
              <option value="">Blank {noun}</option>
              {!!templates.data?.length && <optgroup label="Templates">{templates.data.map(option)}</optgroup>}
              {props.kind === "templates" && !!projects.data?.length && <optgroup label="Projects">{projects.data.map(option)}</optgroup>}
            </select>
            <span className="muted small">
              {form.from
                ? "Sections, objectives, sub-blocks, images and references are copied; comments are not."
                : `An empty ${noun}.`}
            </span>
          </label>
        )}
      </div>
      {error && <p className="render-error">{error}</p>}
    </Dialog>
  );
}

export function DeleteNotebookDialog(props: { target: ProjectSummary | null; onConfirm(): Promise<void>; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [props.target]);
  const t = props.target;
  return (
    <Dialog
      open={!!t}
      title={`Delete “${t?.name ?? ""}”?`}
      onClose={props.onClose}
      actions={
        <>
          <button onClick={props.onClose}>Cancel</button>
          <button
            className="danger solid"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await props.onConfirm();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete {t ? kindLabel(t.kind).toLowerCase() : ""}
          </button>
        </>
      }
    >
      {t && (
        <>
          <p>
            The {kindLabel(t.kind).toLowerCase()} folder <strong>{t.kind}/{t.id}</strong> — {t.sections} section
            {t.sections === 1 ? "" : "s"}, with all sub-blocks, files, references and comments — will be permanently deleted.
          </p>
          {t.kind === "templates" && <p className="muted small">Projects already created from this template are not affected.</p>}
        </>
      )}
      {error && <p className="render-error">{error}</p>}
    </Dialog>
  );
}
