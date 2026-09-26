import { useEffect, useRef, type ReactNode } from "react";

/** Modal built on the native <dialog> element (Esc and backdrop close it). */
export function Dialog(props: {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      className={`dialog${props.wide ? " wide" : ""}`}
      onCancel={(e) => (e.preventDefault(), props.onClose())}
      onClick={(e) => e.target === ref.current && props.onClose()}
    >
      {props.open && (
        <>
          <header className="dialog-head">
            <h2>{props.title}</h2>
            <button className="icon" onClick={props.onClose} aria-label="Close">
              ✕
            </button>
          </header>
          <div className="dialog-body">{props.children}</div>
          {props.actions && <footer className="dialog-actions">{props.actions}</footer>}
        </>
      )}
    </dialog>
  );
}
