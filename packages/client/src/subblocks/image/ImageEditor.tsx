import type { ImageContent } from "@sourcebook/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, blockFileUrl } from "../../api/client";
import { keys } from "../../api/queries";
import { ReferenceImagePicker, type PickedImage } from "../../references/ReferenceImagePicker";
import { Dialog } from "../../components/Dialog";
import type { SubBlockProps } from "../types";

export function ImageEditor({ blockId, subBlock, onChange, saveNow }: SubBlockProps<ImageContent>) {
  const [content, setContent] = useState(subBlock.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** Previous file after a replacement, pending the user's decision. */
  const [replaced, setReplaced] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const qc = useQueryClient();

  const update = (patch: Partial<ImageContent>) => {
    const next = { ...content, ...patch };
    setContent(next);
    onChange(next);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { path } = await api.uploadAsset(blockId, file);
      const previous = content.src;
      update({ src: path, alt: content.alt || file.name.replace(/\.[^.]+$/, "") });
      setNotice(null);
      if (previous && previous !== path) setReplaced(previous);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Copies an image reference or a document figure into the section; the source file is attached (📎). */
  const fromReference = async (img: PickedImage) => {
    setPicking(false);
    setBusy(true);
    setError(null);
    try {
      const r = await api.assetFromReference(blockId, { path: img.path, ...(img.figure ? { figure: img.figure } : {}) }, subBlock.id);
      const previous = content.src;
      update({ src: r.path, alt: r.alt, caption: r.caption || content.caption });
      setNotice(`Copied from references/${img.path}${img.figure ? ` (figure ${img.figure})` : ""} — the source is attached to this sub-block (📎).`);
      if (previous && previous !== r.path) setReplaced(previous);
      void qc.invalidateQueries({ queryKey: keys.block(blockId) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="image-sub">
      <label
        className={`dropzone${dragOver ? " over" : ""}${content.src ? " has-image" : ""}`}
        onDragOver={(e) => (e.preventDefault(), setDragOver(true))}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          upload(e.dataTransfer.files[0]);
        }}
      >
        {content.src ? (
          <figure>
            <img src={blockFileUrl(blockId, content.src)} alt={content.alt} />
            {content.caption && <figcaption>{content.caption}</figcaption>}
          </figure>
        ) : (
          <span>{busy ? "Adding the image…" : "Drop an image here or click to choose a file — or take one from the references"}</span>
        )}
        <input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </label>
      <div className="image-actions">
        <button type="button" disabled={busy} onClick={() => setPicking(true)} title="An image file of the references, or a figure cut out of a reference document (PDF)">
          🖼 {content.src ? "Replace from references…" : "From references…"}
        </button>
      </div>
      <ReferenceImagePicker open={picking} onClose={() => setPicking(false)} onPick={fromReference} />
      {error && <p className="render-error">{error}</p>}
      {notice && <p className="muted small">{notice}</p>}
      <Dialog
        open={!!replaced}
        title="Image replaced"
        onClose={() => setReplaced(null)}
        actions={
          <>
            <button onClick={() => setReplaced(null)}>Keep file</button>
            <button
              className="danger solid"
              onClick={async () => {
                const file = replaced!;
                setReplaced(null);
                try {
                  await saveNow(); // the server checks references against the saved state
                  await api.deleteAsset(blockId, file);
                  setNotice(`Deleted ${file}.`);
                } catch (e) {
                  setNotice(`${file} was kept: ${(e as Error).message}.`);
                }
              }}
            >
              Delete file
            </button>
          </>
        }
      >
        <p>The previous image is still stored in the project folder:</p>
        <ul className="file-list">
          <li>{replaced}</li>
        </ul>
        <p>Delete it? If another sub-block of this section still uses it, it will be kept.</p>
      </Dialog>
      <div className="image-fields">
        <input placeholder="Alt text" value={content.alt} onChange={(e) => update({ alt: e.target.value })} />
        <input placeholder="Caption" value={content.caption} onChange={(e) => update({ caption: e.target.value })} />
      </div>
    </div>
  );
}
