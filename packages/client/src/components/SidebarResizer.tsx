import { useState } from "react";

const KEY = "sourcebook.sidebarWidth";
export const SIDEBAR_DEFAULT = 280;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 640;

const clamp = (w: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));

function load(): number {
  try {
    const w = Number(localStorage.getItem(KEY));
    return w ? clamp(w) : SIDEBAR_DEFAULT;
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

/** Width of the editor sidebar, remembered per browser. */
export function useSidebarWidth() {
  const [width, setWidth] = useState(load);
  const set = (w: number) => {
    const next = clamp(w);
    setWidth(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      // preference only
    }
  };
  return [width, set] as const;
}

const HIDDEN_KEY = "sourcebook.sidebarHidden";

/** Whether the left sidebar is hidden (home and editor), remembered per browser. */
export function useSidebarHidden() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDDEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = (h: boolean) => {
    setHidden(h);
    try {
      if (h) localStorage.setItem(HIDDEN_KEY, "1");
      else localStorage.removeItem(HIDDEN_KEY);
    } catch {
      // preference only
    }
  };
  return [hidden, set] as const;
}

/** Ctrl+\ (⌘+\ on macOS): hide or show the sidebar. */
export const isSidebarShortcut = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && !e.altKey && e.key === "\\";

/**
 * Handle on the sidebar's right edge: drag to resize, arrow keys to adjust, double-click to reset.
 */
export function SidebarResizer({ width, onChange }: { width: number; onChange(w: number): void }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`sidebar-resizer${dragging ? " dragging" : ""}`}
      style={{ left: width - 3 }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = width;
        setDragging(true);
        document.body.classList.add("resizing-sidebar");
        const move = (ev: PointerEvent) => onChange(startW + ev.clientX - startX);
        const up = () => {
          setDragging(false);
          document.body.classList.remove("resizing-sidebar");
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onDoubleClick={() => onChange(SIDEBAR_DEFAULT)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        if (e.key === "ArrowLeft") onChange(width - step);
        else if (e.key === "ArrowRight") onChange(width + step);
        else if (e.key === "Home") onChange(SIDEBAR_MIN);
        else if (e.key === "End") onChange(SIDEBAR_MAX);
        else return;
        e.preventDefault();
      }}
    />
  );
}
