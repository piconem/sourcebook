import type { ImageContent } from "@sourcebook/shared";
import { useState } from "react";
import { api, blockFileUrl } from "../../api/client";
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
          <span>{busy ? "Uploading…" : "Drop an image here or click to choose a file"}</span>
        )}
        <input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </label>
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
