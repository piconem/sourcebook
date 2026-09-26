import { useState } from "react";
import { copyText } from "../clipboard";

/** Copies a reference (e.g. "§2.1 sourcebook://projects/x/sections/<id>") to paste in a chat with the assistant. */
export function CopyReferenceButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon copy-ref"
      title={copied ? "Copied!" : `Copy reference${label ? ` (${label})` : ""} for the assistant`}
      aria-label="Copy reference"
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? "✓" : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
        </svg>
      )}
    </button>
  );
}
