import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";

/** Single text-field dialog (replaces window.prompt, which blocks the page). */
export function PromptDialog(props: {
  open: boolean;
  title: string;
  label: string;
  initialValue?: string;
  submitLabel?: string;
  /** Selects the name without its extension, like file managers do. */
  selectStem?: boolean;
  error?: string | null;
  onSubmit(value: string): void;
  onClose(): void;
}) {
  const [value, setValue] = useState(props.initialValue ?? "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!props.open) return;
    setValue(props.initialValue ?? "");
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      const v = el.value;
      const dot = props.selectStem ? v.lastIndexOf(".") : -1;
      el.setSelectionRange(0, dot > 0 ? dot : v.length);
    });
  }, [props.open, props.initialValue, props.selectStem]);

  const submit = () => value.trim() && props.onSubmit(value.trim());
  return (
    <Dialog
      open={props.open}
      title={props.title}
      onClose={props.onClose}
      actions={
        <>
          <button onClick={props.onClose}>Cancel</button>
          <button className="primary" disabled={!value.trim()} onClick={submit}>
            {props.submitLabel ?? "OK"}
          </button>
        </>
      }
    >
      <label className="field">
        <span>{props.label}</span>
        <input ref={input} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </label>
      {props.error && <p className="render-error">{props.error}</p>}
    </Dialog>
  );
}
