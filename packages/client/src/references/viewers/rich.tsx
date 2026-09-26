import { EditorContent, useEditor } from "@tiptap/react";
import { lazy } from "react";
import { MermaidPreview } from "../../subblocks/mermaid/MermaidPreview";
import { markdownExtensions } from "../../subblocks/markdown/extensions";
import type { ViewerProps } from "./types";

/** Markdown rendered with the same TipTap schema as the Markdown sub-block, read-only. */
export function MarkdownViewer({ text }: ViewerProps) {
  const editor = useEditor({ extensions: markdownExtensions(), content: text ?? "", contentType: "markdown", editable: false });
  return (
    <div className="md-content ref-markdown">
      <EditorContent editor={editor} />
    </div>
  );
}

export function MermaidViewer({ text }: ViewerProps) {
  return (
    <div className="ref-mermaid">
      <MermaidPreview code={text ?? ""} />
    </div>
  );
}

export const ExcalidrawViewer = lazy(() => import("./ExcalidrawViewer"));
