import { useState } from "react";
import { copyText } from "../clipboard";
import { absoluteHref, parseRoute, type Target } from "../router";

/** Copies a link (URL) that opens Sourcebook directly on a section or sub-block. */
export function CopyLinkButton({ target, label }: { target: Target; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon copy-ref"
      title={copied ? "Link copied!" : `Copy link${label ? ` to ${label}` : ""}`}
      aria-label="Copy link"
      onClick={async () => {
        const route = parseRoute(window.location.hash);
        if (route.page !== "editor") return;
        if (await copyText(absoluteHref({ ...route, target }))) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? "✓" : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </svg>
      )}
    </button>
  );
}
