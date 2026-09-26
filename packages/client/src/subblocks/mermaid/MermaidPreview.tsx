import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppearance } from "../../theme/AppearanceContext";
import { renderMermaid } from "./render";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const STEP = 1.25;
const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Natural diagram size, from the SVG viewBox mermaid emits. */
function naturalSize(svg: SVGSVGElement) {
  const vb = svg.viewBox.baseVal;
  if (vb && vb.width && vb.height) return { w: vb.width, h: vb.height };
  const r = svg.getBBox();
  return { w: r.width || 1, h: r.height || 1 };
}

/**
 * Rendered diagram with zoom controls. "Fit" follows the available space (width inline; width and
 * height in the full-page view) and never enlarges beyond 100% inline. Zoom: buttons or Ctrl/⌘ + wheel;
 * pan: drag or scroll. Isolated from the source editor so a future graphical editor can reuse it.
 */
export function MermaidPreview({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [fitZoom, setFitZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const { surfaceScheme } = useAppearance();

  useEffect(() => {
    let cancelled = false;
    if (!code.trim()) {
      setSvg("");
      setError(null);
      return;
    }
    const t = setTimeout(() => {
      renderMermaid(code, surfaceScheme)
        .then((out) => !cancelled && (setSvg(out), setError(null)))
        .catch((e: Error) => !cancelled && setError(e.message));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [code, surfaceScheme]);

  const pannable = () => {
    const vp = viewport.current;
    return !!vp && (vp.scrollWidth > vp.clientWidth || vp.scrollHeight > vp.clientHeight);
  };

  const svgEl = () => canvas.current?.querySelector("svg") ?? null;

  const computeFit = useCallback(() => {
    const el = svgEl();
    const vp = viewport.current;
    if (!el || !vp) return 1;
    const { w, h } = naturalSize(el);
    const expanded = !!vp.closest(".subblock.expanded");
    const byWidth = (vp.clientWidth - 16) / w;
    return clamp(expanded ? Math.min(byWidth, (vp.clientHeight - 16) / h) : Math.min(byWidth, 1));
  }, []);

  const effectiveZoom = zoom === "fit" ? fitZoom : zoom;

  // Size the SVG explicitly from its viewBox so zooming is crisp (vector) and scrollable.
  useLayoutEffect(() => {
    const el = svgEl();
    if (!el) return;
    const { w, h } = naturalSize(el);
    el.removeAttribute("width");
    el.removeAttribute("height");
    el.style.maxWidth = "none";
    el.style.width = `${w * effectiveZoom}px`;
    el.style.height = `${h * effectiveZoom}px`;
    viewport.current?.classList.toggle("can-pan", pannable());
  }, [svg, effectiveZoom]);

  // Keep "fit" in sync with the available space (typing, resizing, entering full page).
  useLayoutEffect(() => {
    if (zoom !== "fit" || !viewport.current) return;
    const update = () => setFitZoom(computeFit());
    update();
    const ro = new ResizeObserver(update);
    ro.observe(viewport.current);
    return () => ro.disconnect();
  }, [zoom, svg, computeFit]);

  /** Changes zoom keeping the point under (cx, cy) — viewport coordinates — in place. */
  const zoomTo = useCallback(
    (next: number, cx?: number, cy?: number) => {
      const vp = viewport.current;
      const target = clamp(next);
      if (!vp) return setZoom(target);
      const px = cx ?? vp.clientWidth / 2;
      const py = cy ?? vp.clientHeight / 2;
      const ratio = target / effectiveZoom;
      const left = (vp.scrollLeft + px) * ratio - px;
      const top = (vp.scrollTop + py) * ratio - py;
      setZoom(target);
      requestAnimationFrame(() => vp.scrollTo({ left, top }));
    },
    [effectiveZoom],
  );

  // Ctrl/⌘ + wheel zoom (non-passive listener so the page itself does not zoom).
  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      zoomTo(effectiveZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - rect.left, e.clientY - rect.top);
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [zoomTo, effectiveZoom]);

  return (
    <div className="preview mermaid-preview">
      {svg && (
        <div className="zoom-controls" role="toolbar" aria-label="Diagram zoom">
          <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomTo(effectiveZoom / STEP)} disabled={effectiveZoom <= MIN_ZOOM}>
            −
          </button>
          <button type="button" className="zoom-level" title="Reset to 100%" onClick={() => zoomTo(1)}>
            {Math.round(effectiveZoom * 100)}%
          </button>
          <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomTo(effectiveZoom * STEP)} disabled={effectiveZoom >= MAX_ZOOM}>
            +
          </button>
          <button
            type="button"
            className={zoom === "fit" ? "active" : undefined}
            title="Fit to available space"
            onClick={() => setZoom("fit")}
          >
            Fit
          </button>
        </div>
      )}
      {error && <pre className="render-error">{error}</pre>}
      <div
        ref={viewport}
        className={`zoom-viewport${error ? " stale" : ""}`}
        onPointerDown={(e) => {
          // Clicks on the scrollbars target the viewport itself: leave them to native scrolling.
          if (e.button !== 0 || e.target === viewport.current || !pannable()) return;
          const vp = viewport.current!;
          drag.current = { x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop };
          vp.setPointerCapture(e.pointerId);
          vp.classList.add("panning");
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          viewport.current!.scrollTo({ left: d.left - (e.clientX - d.x), top: d.top - (e.clientY - d.y) });
        }}
        onPointerUp={(e) => {
          drag.current = null;
          viewport.current?.releasePointerCapture(e.pointerId);
          viewport.current?.classList.remove("panning");
        }}
      >
        <div ref={canvas} className="zoom-canvas" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </div>
  );
}
