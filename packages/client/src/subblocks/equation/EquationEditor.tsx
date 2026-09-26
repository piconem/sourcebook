import type { EquationContent } from "@sourcebook/shared";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo, useState } from "react";
import type { SubBlockProps } from "../types";

export const renderLatex = (latex: string) =>
  katex.renderToString(latex, { displayMode: true, throwOnError: false, output: "html" });

export function EquationEditor({ subBlock, onChange }: SubBlockProps<EquationContent>) {
  const [latex, setLatex] = useState(subBlock.content.latex);
  const html = useMemo(() => renderLatex(latex), [latex]);
  return (
    <div className="split">
      <textarea
        className="source"
        spellCheck={false}
        value={latex}
        onChange={(e) => {
          setLatex(e.target.value);
          onChange({ latex: e.target.value });
        }}
      />
      <div className="preview equation" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
