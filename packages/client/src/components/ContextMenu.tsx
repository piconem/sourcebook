import { useEffect, useRef, useState, type ReactNode } from "react";

/** Small floating menu at (x, y), kept inside the viewport; closes on outside click, Esc or scroll. */
export function ContextMenu(props: { x: number; y: number; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({
        left: Math.min(props.x, window.innerWidth - r.width - 8),
        top: Math.min(props.y, window.innerHeight - r.height - 8),
      });
      el.querySelector("button")?.focus();
    }
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) props.onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("scroll", props.onClose, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("scroll", props.onClose, true);
    };
  }, [props.x, props.y]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className="context-menu" role="menu" style={pos} onClick={(e) => e.stopPropagation()}>
      {props.children}
    </div>
  );
}
