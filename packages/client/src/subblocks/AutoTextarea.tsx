import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

/** Textarea that grows with its content. */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea rows={2} {...props} ref={ref} />;
}
