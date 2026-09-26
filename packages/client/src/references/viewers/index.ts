import { CODE_LANGUAGES } from "@sourcebook/shared";
import { AudioViewer, HtmlViewer, ImageViewer, PdfViewer, TextViewer, VideoViewer, extOf } from "./basic";
import { ExcalidrawViewer, MarkdownViewer, MermaidViewer } from "./rich";
import { BibViewer, JsonViewer, TableViewer } from "./structured";
import type { ReferenceViewer } from "./types";

export type { ReferenceViewer, ViewerProps } from "./types";

/** Max size for text-based previews; larger files are offered as downloads. */
export const MAX_TEXT_PREVIEW = 2 * 1024 * 1024;

const claimed = ["md", "markdown", "html", "htm", "json", "csv", "tsv", "bib", "mmd", "mermaid", "excalidraw", "svg"];
const codeExts = CODE_LANGUAGES.map((l) => l.ext).filter((e) => !claimed.includes(e));

/** First match wins: order specific viewers before the generic text viewer. */
export const VIEWERS: ReferenceViewer[] = [
  { id: "pdf", label: "PDF", exts: ["pdf"], component: PdfViewer, icon: "📕" },
  { id: "image", label: "Image", exts: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg"], component: ImageViewer, icon: "🖼" },
  { id: "audio", label: "Audio", exts: ["mp3", "wav", "ogg", "oga", "m4a", "flac"], component: AudioViewer, icon: "🎵" },
  { id: "video", label: "Video", exts: ["mp4", "webm", "ogv", "mov"], component: VideoViewer, icon: "🎬" },
  { id: "html", label: "HTML", exts: ["html", "htm"], component: HtmlViewer, needsText: true, source: true, icon: "🌐" },
  { id: "markdown", label: "Markdown", exts: ["md", "markdown"], component: MarkdownViewer, needsText: true, source: true, icon: "📝" },
  { id: "table", label: "Table", exts: ["csv", "tsv"], component: TableViewer, needsText: true, source: true, icon: "📊" },
  { id: "json", label: "JSON", exts: ["json"], component: JsonViewer, needsText: true, source: true, icon: "{}" },
  { id: "bibtex", label: "BibTeX", exts: ["bib"], component: BibViewer, needsText: true, source: true, icon: "📚" },
  { id: "mermaid", label: "Mermaid", exts: ["mmd", "mermaid"], component: MermaidViewer, needsText: true, source: true, icon: "⟜" },
  { id: "excalidraw", label: "Excalidraw", exts: ["excalidraw"], component: ExcalidrawViewer, needsText: true, source: true, icon: "✎" },
  {
    id: "text",
    label: "Text",
    exts: [
      "txt", "log", "yaml", "yml", "toml", "xml", "ini", "cfg", "conf", "env", "properties",
      "tex", "sty", "cls", "bst", "ltx", "rst", "adoc", "gitignore", "dockerfile",
      ...codeExts,
    ],
    names: ["readme", "license", "makefile", "dockerfile", "changelog", "authors", "notice"],
    component: TextViewer,
    needsText: true,
    icon: "📄",
  },
];

export function viewerFor(name: string): ReferenceViewer | undefined {
  const ext = extOf(name);
  const lower = name.toLowerCase();
  return VIEWERS.find((v) => (ext && v.exts.includes(ext)) || v.names?.includes(lower));
}
