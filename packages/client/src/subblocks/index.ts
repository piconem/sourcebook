import {
  choiceType,
  codeType,
  csvType,
  createRegistry,
  drawingType,
  equationType,
  imageType,
  markdownType,
  mermaidType,
  questionType,
  type DrawingContent,
  type EquationContent,
  type MermaidContent,
} from "@sourcebook/shared";
import { lazy } from "react";
import { ChoiceEditor } from "./choice/ChoiceEditor";
import { CsvEditor } from "./csv/CsvEditor";
import { CodeEditor } from "./code/CodeEditor";
import { exportDrawing } from "./drawing/export";
import { EquationEditor } from "./equation/EquationEditor";
import { exportEquation } from "./equation/export";
import { ImageEditor } from "./image/ImageEditor";
import { MarkdownEditor } from "./markdown/MarkdownEditor";
import { MermaidEditor } from "./mermaid/MermaidEditor";
import { QuestionEditor } from "./question/QuestionEditor";
import { exportMermaid } from "./mermaid/render";
import type { ClientSubBlockType } from "./types";

const DrawingEditor = lazy(() => import("./drawing/DrawingEditor"));

/**
 * Client registry: shared core definition + UI. Adding a sub-block type = one entry here
 * (and its core definition in @sourcebook/shared); no changes to block/reorder logic.
 */
export const registry = createRegistry<ClientSubBlockType>([
  { ...markdownType, icon: "¶", component: MarkdownEditor },
  {
    ...mermaidType,
    icon: "⟜",
    component: MermaidEditor,
    exportArtifacts: (c: MermaidContent) => exportMermaid(c.code),
  },
  { ...imageType, icon: "🖼", component: ImageEditor },
  {
    ...drawingType,
    icon: "✎",
    component: DrawingEditor,
    exportArtifacts: (c: DrawingContent) => exportDrawing(c),
  },
  {
    ...equationType,
    icon: "∑",
    component: EquationEditor,
    exportArtifacts: (c: EquationContent) => exportEquation(c.latex),
  },
  { ...codeType, icon: "</>", component: CodeEditor },
  { ...questionType, icon: "?", component: QuestionEditor },
  { ...choiceType, icon: "☑", component: ChoiceEditor },
  { ...csvType, icon: "▦", component: CsvEditor },
]);
