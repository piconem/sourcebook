import type { ReferenceImageSource } from "@sourcebook/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, mcpFigureUrl, referenceUrl } from "../api/client";
import { Dialog } from "../components/Dialog";
import { formatSize } from "./ReferenceViewerDialog";

export const referenceImagesKey = ["reference-images"] as const;

export interface PickedImage extends ReferenceImageSource {
  /** Caption of the figure (empty for image files). */
  caption: string;
}

/** Choose an image file of the references, or a figure cut out of a reference document. */
export function ReferenceImagePicker({ open, onPick, onClose, title = "Image from the references" }: { open: boolean; onPick(img: PickedImage): void; onClose(): void; title?: string }) {
  const { data, isLoading } = useQuery({ queryKey: referenceImagesKey, queryFn: api.getReferenceImages, enabled: open });
  const [tab, setTab] = useState<"images" | "figures">("figures");
  const [q, setQ] = useState("");
  const images = data?.images ?? [];
  const figureCount = data?.documents.reduce((n, d) => n + d.figures.length, 0) ?? 0;
  useEffect(() => {
    if (!open) return;
    setQ("");
  }, [open]);
  // Start on the tab that has something.
  useEffect(() => {
    if (data) setTab(figureCount || !images.length ? "figures" : "images");
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const match = (...texts: (string | undefined)[]) => !q.trim() || texts.some((t) => t?.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Dialog open={open} wide title={title} onClose={onClose} actions={<button onClick={onClose}>Cancel</button>}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "figures"} className={tab === "figures" ? "active" : ""} onClick={() => setTab("figures")}>
          Figures from documents ({figureCount})
        </button>
        <button role="tab" aria-selected={tab === "images"} className={tab === "images" ? "active" : ""} onClick={() => setTab("images")}>
          Image files ({images.length})
        </button>
        <input className="bib-search img-pick-search" placeholder={tab === "figures" ? "Search captions, documents…" : "Search file names…"} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {isLoading ? (
        <p className="muted">Loading…</p>
      ) : tab === "images" ? (
        images.length === 0 ? (
          <p className="muted">No image files in the references yet. Upload PNG, JPG, GIF, WebP, SVG or AVIF files in References.</p>
        ) : (
          <div className="img-pick-grid">
            {images
              .filter((i) => match(i.path))
              .map((i) => (
                <button key={i.path} className="img-pick" onClick={() => onPick({ path: i.path, caption: "" })} title={`references/${i.path}`}>
                  <img src={referenceUrl(i.path)} alt="" loading="lazy" />
                  <span className="img-pick-label">
                    <strong>{i.name}</strong>
                    <span>
                      {i.path.includes("/") ? `${i.path.slice(0, i.path.lastIndexOf("/") + 1)} · ` : ""}
                      {formatSize(i.size)}
                    </span>
                  </span>
                </button>
              ))}
          </div>
        )
      ) : !data?.documents.length ? (
        <p className="muted">No figures yet. Figures (images, charts, diagrams) are cut out of PDF references automatically when they are converted for the assistant.</p>
      ) : (
        <div className="img-pick-docs">
          {data.documents.map((d) => {
            const figs = d.figures.filter((f) => match(d.path, f.caption, f.id));
            if (!figs.length) return null;
            return (
              <section key={d.path}>
                <h3 className="img-pick-doc">
                  📕 {d.name} <span className="muted small">· {d.figures.length} figure{d.figures.length === 1 ? "" : "s"}</span>
                </h3>
                <div className="img-pick-grid">
                  {figs.map((f) => (
                    <button key={f.id} className="img-pick" onClick={() => onPick({ path: d.path, figure: f.id, caption: f.caption ?? "" })} title={f.caption ?? f.id}>
                      <img src={mcpFigureUrl(d.path, f.id)} alt="" loading="lazy" />
                      <span className="img-pick-label">
                        <strong>
                          {f.id} · page {f.page}
                        </strong>
                        <span>{f.caption ?? "No caption"}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
