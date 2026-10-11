import { useEffect, useRef, useState, type ReactNode } from "react";

/** A button that opens a small menu below it; closes on outside click, Esc, or after a choice. */
export function PopoverMenu(props: {
  label: string;
  title: string;
  icon: ReactNode;
  /** Extra class of the menu (e.g. a wider panel). */
  className?: string;
  children(close: () => void): ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    wrap.current?.querySelector<HTMLElement>("[role=menuitemradio][aria-checked=true], [role=menuitemradio]")?.focus();
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="popover-wrap" ref={wrap}>
      <button
        className={`icon topbar-btn${open ? " active" : ""}`}
        title={props.title}
        aria-label={props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {props.icon}
      </button>
      {open && (
        <div className={`popover-menu${props.className ? ` ${props.className}` : ""}`} role="menu" aria-label={props.label}>
          {props.children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
