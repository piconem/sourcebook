import { CodeMirror } from "../../components/CodeMirror";
import type { ViewerProps } from "./types";

export const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

export function PdfViewer({ url, node }: ViewerProps) {
  return <iframe className="ref-frame" src={url} title={node.name} />;
}

export function ImageViewer({ url, node }: ViewerProps) {
  return (
    <div className="ref-image">
      <img src={url} alt={node.name} />
    </div>
  );
}

export function AudioViewer({ url }: ViewerProps) {
  return (
    <div className="ref-media">
      <audio src={url} controls />
    </div>
  );
}

export function VideoViewer({ url }: ViewerProps) {
  return (
    <div className="ref-media">
      <video src={url} controls />
    </div>
  );
}

/** HTML is shown without scripts: empty sandbox here, plus a sandboxing CSP from the server. */
export function HtmlViewer({ url, node }: ViewerProps) {
  return <iframe className="ref-frame light" src={url} title={node.name} sandbox="" />;
}

export function TextViewer({ node, text }: ViewerProps) {
  return <CodeMirror initialValue={text ?? ""} ext={extOf(node.name) || "txt"} readOnly maxHeight="none" />;
}
