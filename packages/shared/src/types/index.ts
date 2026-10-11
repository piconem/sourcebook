import { createRegistry, type SubBlockTypeCore } from "../registry.js";
import { markdownType } from "./markdown.js";
import { mermaidType } from "./mermaid.js";
import { imageType } from "./image.js";
import { drawingType } from "./drawing.js";
import { equationType } from "./equation.js";
import { codeType } from "./code.js";
import { questionType } from "./question.js";
import { choiceType } from "./choice.js";

export { markdownType, mermaidType, imageType, drawingType, equationType, codeType, questionType, choiceType };
export type { MarkdownContent } from "./markdown.js";
export type { MermaidContent } from "./mermaid.js";
export type { ImageContent } from "./image.js";
export type { DrawingContent } from "./drawing.js";
export type { EquationContent } from "./equation.js";
export type { CodeContent } from "./code.js";
export type { QuestionContent } from "./question.js";
export type { ChoiceContent, ChoiceOption } from "./choice.js";

export const coreTypes: SubBlockTypeCore<any>[] = [
  markdownType,
  mermaidType,
  imageType,
  drawingType,
  equationType,
  codeType,
  questionType,
  choiceType,
];

export const createCoreRegistry = () => createRegistry(coreTypes);
