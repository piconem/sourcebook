import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Optional "why does this exist" note for a section or sub-block. Saved on blur; clearing the
 * text removes it. Exported as a Markdown comment.
 */
export function ObjectiveField(props: {
  value: string | undefined;
  onSave(text: string): void;
  autoFocus?: boolean;
  /** Called when the field loses focus while empty (lets the parent hide it again). */
  onEmptyBlur?(): void;
  placeholder?: string;
}) {
  const [text, setText] = useState(props.value ?? "");
  const [focused, setFocused] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!focused) setText(props.value ?? "");
  }, [props.value, focused]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);

  return (
    <div className="objective surface">
      <label className="objective-label" htmlFor={undefined}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1" />
        </svg>
        Objective
      </label>
      <textarea
        ref={area}
        rows={1}
        value={text}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder ?? "Why does this exist? What should it achieve?"}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          const next = text.trim();
          if (next !== (props.value ?? "").trim()) props.onSave(next);
          if (!next) props.onEmptyBlur?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
        }}
      />
    </div>
  );
}
