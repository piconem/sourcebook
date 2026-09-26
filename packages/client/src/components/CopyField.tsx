import { useState } from "react";
import { copyText } from "../clipboard";

/** A labelled, copyable value (single line or pre-formatted block). */
export function CopyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <div className="copy-field-head">
        <span>{label}</span>
        <button
          type="button"
          className="link"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            if (await copyText(value)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      {multiline ? <pre className="copy-value">{value}</pre> : <code className="copy-value">{value}</code>}
    </div>
  );
}
