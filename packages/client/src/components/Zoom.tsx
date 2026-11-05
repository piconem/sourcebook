import { useState } from "react";

/** Zoom levels of the editor's main area, as in word processors and browsers. */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
const KEY = "sourcebook.zoom";

const nearest = (z: number) => ZOOM_STEPS.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));

function load(): number {
  try {
    const z = Number(localStorage.getItem(KEY));
    return z ? nearest(z) : 1;
  } catch {
    return 1;
  }
}

/** Next level up (+1) or down (-1), staying within the steps. */
export function stepZoom(z: number, dir: 1 | -1): number {
  const i = ZOOM_STEPS.indexOf(nearest(z) as (typeof ZOOM_STEPS)[number]);
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))];
}

/** Zoom of the document area (not of the whole page), remembered per browser. */
export function useZoom() {
  const [zoom, setZoomState] = useState(load);
  const setZoom = (z: number) => {
    const next = nearest(z);
    setZoomState(next);
    try {
      if (next === 1) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, String(next));
    } catch {
      // preference only
    }
  };
  return [zoom, setZoom] as const;
}

/** "− 100% +" in the top bar: zoom out, reset (click on the percentage), zoom in. */
export function ZoomControl({ zoom, onChange }: { zoom: number; onChange(z: number): void }) {
  const min = zoom <= ZOOM_STEPS[0];
  const max = zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return (
    <div className="zoom-control" role="group" aria-label="Zoom">
      <button className="icon topbar-btn" title="Zoom out (Ctrl + mouse wheel on the document)" aria-label="Zoom out" disabled={min} onClick={() => onChange(stepZoom(zoom, -1))}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M5 12h14" />
        </svg>
      </button>
      <button className="zoom-value" title="Reset zoom to 100%" aria-label={`Zoom ${Math.round(zoom * 100)}%, reset`} onClick={() => onChange(1)}>
        {Math.round(zoom * 100)}%
      </button>
      <button className="icon topbar-btn" title="Zoom in (Ctrl + mouse wheel on the document)" aria-label="Zoom in" disabled={max} onClick={() => onChange(stepZoom(zoom, 1))}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M5 12h14M12 5v14" />
        </svg>
      </button>
    </div>
  );
}
