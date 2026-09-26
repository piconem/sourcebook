import type { AiTarget } from "./prompts";
import { useAskAi } from "./AskAiContext";

/** Speech bubble with sparkles. */
export function AskAiIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 12.5a7.5 7.5 0 0 1-10.9 6.7L4 20.5l1.3-4.6A7.5 7.5 0 0 1 11 5.2" />
      <path d="M17.5 2.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" fill="currentColor" />
      <path d="M21 8.5l.4.9.9.4-.9.4-.4.9-.4-.9-.9-.4.9-.4z" fill="currentColor" />
      <path d="M9 12h.01M12.5 12h.01" />
    </svg>
  );
}

/** "Ask AI" about an element; renders nothing outside a project editor. */
export function AskAiButton({ target, label, className = "icon ask-ai-btn" }: { target: () => AiTarget; label?: string; className?: string }) {
  const open = useAskAi();
  if (!open) return null;
  return (
    <button
      type="button"
      className={className}
      title="Ask AI — prepare a request for the assistant about this"
      aria-label="Ask AI"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => open(target())}
    >
      <AskAiIcon />
      {label && <span>{label}</span>}
    </button>
  );
}
