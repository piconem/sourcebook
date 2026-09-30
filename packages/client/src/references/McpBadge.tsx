import type { McpInfo } from "@sourcebook/shared";

const units = (info: McpInfo) => {
  const n = info.parts ?? 0;
  return info.unit && info.unit !== "document" && n ? `${n} ${info.unit}${n === 1 ? "" : "s"}` : "";
};

/** Whether the assistant can read a file (Yes / No / Converting), its tooltip and style. */
export function mcpBadgeInfo(info: McpInfo): { label: "Yes" | "No" | "Converting"; title: string; tone: "ok" | "busy" | "bad" | "off" } {
  switch (info.status) {
    case "native":
      return info.kind === "image"
        ? { label: "Yes", tone: "ok", title: "The assistant receives this image as it is." }
        : { label: "Yes", tone: "ok", title: "The assistant reads this text file as it is." };
    case "ready": {
      const bits = [`Converted to Markdown${units(info) ? ` (${units(info)})` : ""}.`];
      if (info.figures) bits.push(`${info.figures} figure(s) cut out as images.`);
      if (info.imageOnlyParts) bits.push(`${info.imageOnlyParts} page(s) without text are read as images.`);
      return { label: "Yes", tone: "ok", title: bits.join(" ") };
    }
    case "stale":
      return { label: "Converting", tone: "busy", title: "The file changed: it is being converted again." };
    case "pending":
      return { label: "Converting", tone: "busy", title: "Waiting to be converted to Markdown." };
    case "converting":
      return { label: "Converting", tone: "busy", title: "Being converted to Markdown." };
    case "failed":
      return { label: "No", tone: "bad", title: `The conversion failed: ${info.error ?? "unknown error"}.` };
    case "unsupported":
      return { label: "No", tone: "off", title: "Sourcebook cannot convert this format: the assistant cannot read it." };
  }
}

/** Folder icon. */
function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M8 13h8M8 16h5" />
    </svg>
  );
}

/**
 * Whether the assistant can read a file — Yes / No / Converting — and, for converted documents, a folder
 * button opening the details of the conversion (Markdown, figures, pages).
 */
export function McpBadge({ info, onInspect }: { info: McpInfo | undefined; onInspect?(): void }) {
  if (!info) return null;
  const b = mcpBadgeInfo(info);
  const inspectable = !!onInspect && info.kind === "markdown" && (info.status === "ready" || info.status === "stale" || info.status === "failed");
  return (
    <span className="mcp-status">
      <span className={`mcp-badge mcp-tone-${b.tone}`} title={b.title}>
        <span className="mcp-dot" aria-hidden="true" />
        {b.label}
      </span>
      {inspectable && (
        <button
          type="button"
          className="icon mcp-inspect"
          title={info.status === "failed" ? "See why the conversion failed" : "See the converted content (Markdown, figures, pages)"}
          aria-label="Conversion details"
          onClick={(e) => (e.stopPropagation(), onInspect!())}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <FolderIcon />
        </button>
      )}
    </span>
  );
}
