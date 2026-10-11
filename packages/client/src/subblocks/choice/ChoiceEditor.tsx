import type { ChoiceContent, ChoiceOption } from "@sourcebook/shared";
import { useState } from "react";
import { AutoTextarea } from "../AutoTextarea";
import type { SubBlockProps } from "../types";

/** Short option id not used by the other options. */
function newOptionId(options: ChoiceOption[]) {
  const used = new Set(options.map((o) => o.id));
  let id: string;
  do id = Math.random().toString(36).slice(2, 8);
  while (used.has(id));
  return id;
}

export function ChoiceEditor({ subBlock, onChange, saveNow }: SubBlockProps<ChoiceContent>) {
  const [content, setContent] = useState(subBlock.content);
  // The note is edited as a draft and stored only with "Save note".
  const [note, setNote] = useState(subBlock.content.note);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ChoiceContent>) => {
    const next = { ...content, ...patch };
    setContent(next);
    onChange(next);
    return next;
  };
  const { options, selected, mode } = content;
  const toggle = (id: string) =>
    set({ selected: mode === "single" ? (selected.includes(id) ? [] : [id]) : selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id] });
  const setOption = (i: number, text: string) => set({ options: options.map((o, j) => (j === i ? { ...o, text } : o)) });
  const removeOption = (id: string) => set({ options: options.filter((o) => o.id !== id), selected: selected.filter((s) => s !== id) });
  const moveOption = (i: number, by: number) => {
    const next = [...options];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    set({ options: next });
  };
  const noteDirty = note !== content.note;
  const saveNote = async () => {
    set({ note });
    setSaving(true);
    try {
      await saveNow();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="choice">
      <AutoTextarea className="qa-question" value={content.question} placeholder="Write the question…" aria-label="Question" onChange={(e) => set({ question: e.target.value })} />
      <div className="choice-mode" role="radiogroup" aria-label="Answer mode">
        <label>
          <input type="radio" checked={mode === "single"} onChange={() => set({ mode: "single", selected: selected.slice(0, 1) })} /> Single answer
        </label>
        <label>
          <input type="radio" checked={mode === "multiple"} onChange={() => set({ mode: "multiple" })} /> Multiple answers
        </label>
      </div>
      <ul className="choice-options">
        {options.map((o, i) => (
          <li key={o.id} className={selected.includes(o.id) ? "selected" : undefined}>
            <input
              type={mode === "single" ? "radio" : "checkbox"}
              checked={selected.includes(o.id)}
              onChange={() => toggle(o.id)}
              onClick={(e) => mode === "single" && selected.includes(o.id) && (e.preventDefault(), toggle(o.id))}
              aria-label={`Select “${o.text}”`}
            />
            <input className="choice-text" value={o.text} placeholder={`Option ${i + 1}`} onChange={(e) => setOption(i, e.target.value)} />
            <button className="icon" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => moveOption(i, -1)}>↑</button>
            <button className="icon" title="Move down" aria-label="Move down" disabled={i === options.length - 1} onClick={() => moveOption(i, 1)}>↓</button>
            <button className="icon danger" title="Remove option" aria-label="Remove option" onClick={() => removeOption(o.id)}>✕</button>
          </li>
        ))}
      </ul>
      <button className="link" onClick={() => set({ options: [...options, { id: newOptionId(options), text: "" }] })}>
        + Add option
      </button>
      <div className="choice-note">
        <span className="qa-label">Note</span>
        <AutoTextarea value={note} placeholder="Add a note about this choice…" aria-label="Note" onChange={(e) => setNote(e.target.value)} />
        <div className="choice-note-actions">
          {noteDirty && <span className="muted small">Unsaved note</span>}
          <button disabled={!noteDirty} onClick={() => setNote(content.note)}>Cancel</button>
          <button className="primary" disabled={!noteDirty || saving} onClick={saveNote}>
            Save note
          </button>
        </div>
      </div>
    </div>
  );
}
