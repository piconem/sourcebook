import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { api } from "../api/client";
import { Avatar, avatarsKey, useAvatars } from "./Avatar";
import { Dialog } from "./Dialog";

/** Side of the crop area on screen and of the picture sent to the server (px). */
const VIEW = 260;
const OUTPUT = 256;

interface Crop {
  /** Displayed size of the image (px) at the current zoom. */
  w: number;
  h: number;
  /** Top-left corner of the image relative to the crop area. */
  x: number;
  y: number;
}

/** Keeps the crop area covered by the image. */
const clamp = (c: Crop): Crop => ({ ...c, x: Math.min(0, Math.max(VIEW - c.w, c.x)), y: Math.min(0, Math.max(VIEW - c.h, c.y)) });

/**
 * Square crop of an image: drag to move it, zoom with the slider or the wheel. The circle shows how the picture
 * will appear; the whole square is saved.
 */
export function AvatarCropDialog(props: { file: File | null; onCancel(): void; onCrop(dataUrl: string): Promise<void> }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    setImg(null);
    setCrop(null);
    setZoom(1);
    setError(null);
    if (!props.file) return;
    const url = URL.createObjectURL(props.file);
    const image = new Image();
    image.onload = () => setImg(image);
    image.onerror = () => setError("This file is not an image the browser can read.");
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [props.file]);

  /** Zoom 1 = the image just covers the square; the crop stays centred on the same point. */
  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  useEffect(() => {
    if (!img) return;
    setCrop((prev) => {
      const w = img.naturalWidth * base * zoom;
      const h = img.naturalHeight * base * zoom;
      if (!prev) return clamp({ w, h, x: (VIEW - w) / 2, y: (VIEW - h) / 2 });
      const cx = (VIEW / 2 - prev.x) / prev.w;
      const cy = (VIEW / 2 - prev.y) / prev.h;
      return clamp({ w, h, x: VIEW / 2 - cx * w, y: VIEW / 2 - cy * h });
    });
  }, [img, zoom, base]);

  const onDown = (e: PointerEvent) => {
    if (!crop) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || !crop) return;
    setCrop(clamp({ ...crop, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
  };

  const save = async () => {
    if (!img || !crop) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return setError("Cannot crop in this browser.");
    const k = OUTPUT / VIEW;
    ctx.drawImage(img, crop.x * k, crop.y * k, crop.w * k, crop.h * k);
    setSaving(true);
    setError(null);
    try {
      await props.onCrop(canvas.toDataURL("image/png"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={!!props.file}
      title="Crop the picture"
      onClose={props.onCancel}
      actions={
        <>
          <button onClick={props.onCancel}>Cancel</button>
          <button className="primary" disabled={!crop || saving} onClick={save}>
            {saving ? "Saving…" : "Save picture"}
          </button>
        </>
      }
    >
      <div className="avatar-crop">
        <div
          className="avatar-crop-area"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onWheel={(e) => setZoom((z) => Math.min(4, Math.max(1, z - e.deltaY * 0.002)))}
        >
          {img && crop && (
            <img src={img.src} alt="" draggable={false} style={{ width: crop.w, height: crop.h, transform: `translate(${crop.x}px, ${crop.y}px)` }} />
          )}
          <span className="avatar-crop-mask" aria-hidden="true" />
        </div>
        <label className="avatar-crop-zoom small">
          Zoom
          <input type="range" min={1} max={4} step={0.01} value={zoom} disabled={!img} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
        </label>
        <p className="muted small">Drag to choose the part to keep. It is shown in a circle.</p>
        {error && <p className="render-error">{error}</p>}
      </div>
    </Dialog>
  );
}

/** Picture of a user or agent with buttons to change (crop) or remove it. */
export function AvatarPicker(props: { id: string; name: string; size?: number; compact?: boolean }) {
  const qc = useQueryClient();
  const has = useAvatars()[props.id] !== undefined;
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const update = (avatars: Record<string, number>) => qc.setQueryData(avatarsKey, avatars);
  return (
    <span className={`avatar-picker${props.compact ? " compact" : ""}`}>
      <button
        type="button"
        className="avatar-picker-button"
        title={has ? "Change the picture" : "Add a picture"}
        aria-label={`${has ? "Change" : "Add"} the picture of ${props.name}`}
        onClick={() => input.current?.click()}
      >
        <Avatar name={props.name} username={props.id} size={props.size ?? 48} />
        <span className="avatar-picker-badge" aria-hidden="true">
          📷
        </span>
      </button>
      {!props.compact && has && (
        <button
          type="button"
          className="link small"
          onClick={async () => {
            setError(null);
            try {
              update(await api.deleteAvatar(props.id));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Remove picture
        </button>
      )}
      {error && <span className="field-error">{error}</span>}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      <AvatarCropDialog
        file={file}
        onCancel={() => setFile(null)}
        onCrop={async (dataUrl) => {
          update(await api.setAvatar(props.id, dataUrl));
          setFile(null);
        }}
      />
    </span>
  );
}
