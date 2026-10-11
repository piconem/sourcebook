import type { QuestionContent } from "@sourcebook/shared";
import { useState } from "react";
import { AutoTextarea } from "../AutoTextarea";
import type { SubBlockProps } from "../types";

export function QuestionEditor({ subBlock, onChange }: SubBlockProps<QuestionContent>) {
  const [content, setContent] = useState(subBlock.content);
  const set = (patch: Partial<QuestionContent>) => {
    const next = { ...content, ...patch };
    setContent(next);
    onChange(next);
  };
  return (
    <div className="qa">
      <label className="qa-field">
        <span className="qa-label">Question</span>
        <AutoTextarea className="qa-question" value={content.question} placeholder="Write the question…" onChange={(e) => set({ question: e.target.value })} />
      </label>
      <label className="qa-field">
        <span className="qa-label">Answer</span>
        <AutoTextarea value={content.answer} placeholder="No answer yet" onChange={(e) => set({ answer: e.target.value })} />
      </label>
    </div>
  );
}
