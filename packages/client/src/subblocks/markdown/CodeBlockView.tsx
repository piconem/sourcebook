import { CODE_LANGUAGES } from "@sourcebook/shared";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { codeBlock } from "./extensions";

function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const language: string = node.attrs.language ?? "";
  const known = CODE_LANGUAGES.some((l) => l.id === language);
  return (
    <NodeViewWrapper className="code-block">
      <select
        contentEditable={false}
        className="code-lang"
        value={language || "plaintext"}
        onChange={(e) => updateAttributes({ language: e.target.value === "plaintext" ? null : e.target.value })}
      >
        {!known && language && <option value={language}>{language}</option>}
        {CODE_LANGUAGES.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
      <pre>
        <NodeViewContent<"code"> as="code" className={language ? `language-${language}` : undefined} />
      </pre>
    </NodeViewWrapper>
  );
}

export const codeBlockWithPicker = codeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
