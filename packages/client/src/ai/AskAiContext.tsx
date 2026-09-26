import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { copyText } from "../clipboard";
import { CopyField } from "../components/CopyField";
import { Dialog } from "../components/Dialog";
import { mcpSettingsKey } from "../settings/McpSettingsSection";
import { MODES, buildPrompt, modeBlocked, modesFor, referenceFor, type AiMode, type AiProject, type AiTarget } from "./prompts";

const Ctx = createContext<((target: AiTarget) => void) | null>(null);

/** Opens the Ask AI dialog for a target; null outside a project editor. */
export const useAskAi = () => useContext(Ctx);

const MODE_KEY = "sourcebook.askAi.mode";
const loadMode = (): AiMode | null => {
  try {
    return localStorage.getItem(MODE_KEY) as AiMode | null;
  } catch {
    return null;
  }
};

function AskAiDialog({ project, target, onClose }: { project: AiProject; target: AiTarget | null; onClose(): void }) {
  const { data: settings } = useQuery({ queryKey: mcpSettingsKey, queryFn: api.getMcpSettings, enabled: !!target });
  const readOnly = !!settings?.readOnly;
  const mcpOff = !!settings && !settings.http.enabled && !settings.stdio.enabled;
  const available = target ? modesFor(target) : [];
  const [mode, setMode] = useState<AiMode>("brainstorm");
  const [notes, setNotes] = useState("");
  const [copied, setCopied] = useState(false);

  // On open: the last used mode if it applies here, otherwise the first usable one.
  useEffect(() => {
    if (!target) return;
    setNotes("");
    setCopied(false);
    const usable = modesFor(target).filter((m) => !modeBlocked(m, { readOnly }));
    const last = loadMode();
    setMode(last && usable.includes(last) ? last : (usable[0] ?? "custom"));
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return <Dialog open={false} title="" onClose={onClose}>{null}</Dialog>;
  const prompt = buildPrompt(project, target, mode, notes);
  const choose = (m: AiMode) => {
    setMode(m);
    setCopied(false);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // preference only
    }
  };

  return (
    <Dialog
      open
      wide
      title="Ask AI"
      onClose={onClose}
      actions={
        <>
          <span className="muted small">Paste it in a chat with an assistant connected to the Sourcebook MCP server.</span>
          <button onClick={onClose}>Close</button>
          <button
            className="primary"
            onClick={async () => {
              if (await copyText(prompt)) setCopied(true);
            }}
          >
            {copied ? "Copied ✓" : "Copy prompt"}
          </button>
        </>
      }
    >
      <p className="ask-ai-target">{referenceFor(project, target)}</p>
      {mcpOff && <p className="notice render-error small">The MCP server is disabled (Settings → AI assistant): enable HTTP or stdio so the assistant can reach Sourcebook.</p>}
      <div className="ask-ai-modes" role="radiogroup" aria-label="Kind of interaction">
        {MODES.filter((m) => available.includes(m.id)).map((m) => {
          const blocked = modeBlocked(m.id, { readOnly });
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              disabled={!!blocked}
              title={blocked ?? m.hint}
              className={`ask-ai-mode${mode === m.id ? " selected" : ""}`}
              onClick={() => choose(m.id)}
            >
              <strong>{m.label}</strong>
              <span>{blocked ?? m.hint}</span>
            </button>
          );
        })}
      </div>
      <label className="field">
        <span>{mode === "custom" ? "Your request" : "Additional instructions (optional)"}</span>
        <textarea
          rows={3}
          value={notes}
          placeholder={mode === "custom" ? "e.g. Explain this to a new team member in 5 bullet points" : "e.g. Keep it under 300 words; focus on security"}
          onChange={(e) => {
            setNotes(e.target.value);
            setCopied(false);
          }}
        />
      </label>
      <div className="ask-ai-output">
        <CopyField label="Reference (for the MCP tools)" value={referenceFor(project, target)} />
        <CopyField label="Prompt" value={prompt} multiline />
      </div>
    </Dialog>
  );
}

/** Provides "Ask AI" to every referenceable element of the open project/template. */
export function AskAiProvider({ project, children }: { project: AiProject; children: ReactNode }) {
  const [target, setTarget] = useState<AiTarget | null>(null);
  const open = useCallback((t: AiTarget) => setTarget(t), []);
  const stableProject = useMemo(() => project, [project.kind, project.id, project.name]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Ctx.Provider value={open}>
      {children}
      <AskAiDialog project={stableProject} target={target} onClose={() => setTarget(null)} />
    </Ctx.Provider>
  );
}
