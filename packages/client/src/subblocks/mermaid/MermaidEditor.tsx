import type { MermaidContent } from "@sourcebook/shared";
import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import type { SubBlockProps } from "../types";
import { MermaidPreview } from "./MermaidPreview";
import { MERMAID_KINDS, detectKind, hasUserWork, type MermaidKind } from "./templates";

function KindGallery({ onPick }: { onPick(kind: MermaidKind): void }) {
  return (
    <div className="mermaid-gallery">
      <p className="muted">Choose a diagram type to start from an example:</p>
      <div className="mermaid-kinds">
        {MERMAID_KINDS.map((k) => (
          <button key={k.id} type="button" className="mermaid-kind" onClick={() => onPick(k)}>
            <strong>{k.label}</strong>
            <span>{k.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function MermaidEditor({ subBlock, onChange }: SubBlockProps<MermaidContent>) {
  const [code, setCode] = useState(subBlock.content.code);
  const [pending, setPending] = useState<MermaidKind | null>(null);
  const current = detectKind(code);

  const setAndSave = (next: string) => {
    setCode(next);
    onChange({ code: next });
  };

  const requestKind = (kind: MermaidKind) => {
    if (kind.id === current?.id && code.trim()) return;
    if (hasUserWork(code)) setPending(kind);
    else setAndSave(kind.template);
  };

  return (
    <div className="mermaid-sub">
      <div className="sub-toolbar">
        <label>
          Diagram type{" "}
          <select
            value={current?.id ?? ""}
            onChange={(e) => {
              const kind = MERMAID_KINDS.find((k) => k.id === e.target.value);
              if (kind) requestKind(kind);
            }}
          >
            <option value="" disabled>
              {code.trim() ? "Unrecognized" : "Choose…"}
            </option>
            {MERMAID_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {current && <span className="muted small">{current.description}</span>}
      </div>

      {code.trim() === "" ? (
        <KindGallery onPick={requestKind} />
      ) : (
        <div className="split">
          <textarea
            className="source"
            spellCheck={false}
            value={code}
            onChange={(e) => setAndSave(e.target.value)}
          />
          <MermaidPreview code={code} />
        </div>
      )}

      <Dialog
        open={!!pending}
        title={`Switch to ${pending?.label ?? ""}?`}
        onClose={() => setPending(null)}
        actions={
          <>
            <button onClick={() => setPending(null)}>Keep current diagram</button>
            <button
              className="danger solid"
              onClick={() => {
                if (pending) setAndSave(pending.template);
                setPending(null);
              }}
            >
              Replace with example
            </button>
          </>
        }
      >
        <p>
          The current diagram{current ? ` (${current.label})` : ""} will be <strong>replaced</strong> by the{" "}
          {pending?.label} example and your work on it will be lost.
        </p>
      </Dialog>
    </div>
  );
}
