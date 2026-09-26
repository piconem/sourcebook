import { useEffect, useRef, useState } from "react";
import { registry } from "../subblocks";

/** Sub-block type buttons, centered. */
function TypeOptions({ onPick, onClose }: { onPick(type: string): void; onClose?(): void }) {
  return (
    <div className="insert-options" role="group" aria-label="Add a sub-block">
      {registry.list().map((t) => (
        <button key={t.type} type="button" onClick={() => onPick(t.type)}>
          <span aria-hidden="true">{t.icon}</span> {t.label}
        </button>
      ))}
      {onClose && (
        <button type="button" className="icon insert-close" title="Cancel (Esc)" aria-label="Cancel" onClick={onClose}>
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * Where a new sub-block can be inserted. Between sub-blocks it is a thin gap that reveals a line with a
 * centered "+" on hover (or keyboard focus); clicking it shows the type options. At the end (`persistent`)
 * the options are always visible.
 */
export function InsertPoint(props: { position: number; persistent?: boolean; label?: string; onInsert(type: string, position: number): void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLButtonElement>(".insert-options button")?.focus();
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (type: string) => {
    setOpen(false);
    props.onInsert(type, props.position);
  };

  if (props.persistent) {
    return (
      <div className="insert-point persistent" data-position={props.position}>
        {props.label && <p className="muted small insert-label">{props.label}</p>}
        <TypeOptions onPick={pick} />
      </div>
    );
  }
  return (
    <div ref={ref} className={`insert-point${open ? " open" : ""}`} data-position={props.position}>
      {open ? (
        <TypeOptions onPick={pick} onClose={() => setOpen(false)} />
      ) : (
        <button type="button" className="insert-plus" title="Insert a sub-block here" aria-label={`Insert a sub-block at position ${props.position + 1}`} onClick={() => setOpen(true)}>
          +
        </button>
      )}
    </div>
  );
}
