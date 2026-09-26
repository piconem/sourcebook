import { PopoverMenu } from "./PopoverMenu";
import type { ScrollMode } from "./scrollMode";

const SectionIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
);
const DocumentIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="2" width="14" height="8" rx="1.5" />
    <rect x="5" y="14" width="14" height="8" rx="1.5" />
    <path d="M12 10v4M10 12l2 2 2-2" />
  </svg>
);

const OPTIONS: { mode: ScrollMode; label: string; description: string; Icon: () => JSX.Element }[] = [
  { mode: "section", label: "Section", description: "Show and scroll only the selected section", Icon: SectionIcon },
  { mode: "document", label: "Document", description: "Scroll through all sections as one document", Icon: DocumentIcon },
];

export function ScrollModeButton({ mode, onChange }: { mode: ScrollMode; onChange(mode: ScrollMode): void }) {
  const current = OPTIONS.find((o) => o.mode === mode)!;
  return (
    <PopoverMenu label="Scrolling mode" title={`Scrolling: ${current.label} — change`} icon={<current.Icon />}>
      {(close) => (
        <>
          <div className="popover-title">Scrolling</div>
          {OPTIONS.map(({ mode: m, label, description, Icon }) => (
            <button
              key={m}
              role="menuitemradio"
              aria-checked={m === mode}
              className={`popover-item${m === mode ? " checked" : ""}`}
              onClick={() => {
                onChange(m);
                close();
              }}
            >
              <span className="popover-item-icon">
                <Icon />
              </span>
              <span className="popover-item-text">
                <strong>{label}</strong>
                <span className="muted small">{description}</span>
              </span>
              <span className="popover-check" aria-hidden="true">
                {m === mode ? "✓" : ""}
              </span>
            </button>
          ))}
        </>
      )}
    </PopoverMenu>
  );
}
