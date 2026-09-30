import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { keys, useProject } from "../api/queries";
import { Dialog } from "../components/Dialog";
import { outlineNumbers, withDepth } from "../tree";
import type { PickedImage } from "./ReferenceImagePicker";

/** Adds an image reference or a document figure to a section, as a new image sub-block. */
export function InsertImageDialog({ source, preview, onClose, onDone }: { source: PickedImage | null; preview?: string; onClose(): void; onDone?(message: string): void }) {
  const qc = useQueryClient();
  const { data: project } = useProject();
  const sections = useMemo(() => {
    if (!project) return [];
    const flat = withDepth(project.blocks);
    const numbers = outlineNumbers(flat);
    return flat.map((b) => ({ id: b.id, label: `${"\u00A0\u00A0".repeat(b.depth)}${numbers.get(b.id)} ${b.title}`, number: numbers.get(b.id) }));
  }, [project]);
  const [section, setSection] = useState("");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!source) return;
    setCaption(source.caption);
    setError(null);
    setSection((s) => s || sections[0]?.id || "");
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    if (!source || !section) return;
    setBusy(true);
    setError(null);
    try {
      await api.imageFromReference(section, { path: source.path, ...(source.figure ? { figure: source.figure } : {}), caption });
      await qc.invalidateQueries({ queryKey: keys.project });
      await qc.invalidateQueries({ queryKey: keys.block(section) });
      const s = sections.find((x) => x.id === section);
      onDone?.(`Added to §${s?.number} ${s?.label.trim().replace(/^\S+\s/, "") ?? ""} as an image sub-block.`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!source}
      title="Insert into a section"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!section || busy} onClick={add}>
            {busy ? "Adding…" : "Add image"}
          </button>
        </>
      }
    >
      {source && (
        <div className="insert-image">
          {preview && <img className="insert-image-preview" src={preview} alt="" />}
          <p className="muted small">
            From references/{source.path}
            {source.figure ? ` · figure ${source.figure}` : ""} — copied into the section; the source file is attached to the new sub-block (📎).
          </p>
          {sections.length === 0 ? (
            <p className="render-error">This project has no sections yet: create one first.</p>
          ) : (
            <label className="field">
              <span>Section</span>
              <select value={section} onChange={(e) => setSection(e.target.value)}>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Caption</span>
            <textarea rows={2} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Optional" />
          </label>
          {error && <p className="render-error">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}
