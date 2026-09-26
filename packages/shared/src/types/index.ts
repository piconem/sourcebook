import { createRegistry, type SubBlockTypeCore } from "../registry.js";
import { markdownType } from "./markdown.js";
import { mermaidType } from "./mermaid.js";
import { imageType } from "./image.js";
import { drawingType } from "./drawing.js";
import { equationType } from "./equation.js";
import { codeType } from "./code.js";

export { markdownType, mermaidType, imageType, drawingType, equationType, codeType };
export type { MarkdownContent } from "./markdown.js";
export type { MermaidContent } from "./mermaid.js";
export type { ImageContent } from "./image.js";
export type { DrawingContent } from "./drawing.js";
export type { EquationContent } from "./equation.js";
export type { CodeContent } from "./code.js";

export const coreTypes: SubBlockTypeCore<any>[] = [
  markdownType,
  mermaidType,
  imageType,
  drawingType,
  equationType,
  codeType,
];

export const createCoreRegistry = () => createRegistry(coreTypes);
