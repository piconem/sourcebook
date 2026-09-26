import { z } from "zod";
import type { SubBlockTypeCore } from "../registry.js";

const schema = z.object({ latex: z.string() });
export type EquationContent = z.infer<typeof schema>;

export const equationType: SubBlockTypeCore<EquationContent> = {
  type: "equation",
  label: "Equation",
  sourceExt: "tex",
  contentSchema: schema,
  defaultContent: () => ({ latex: "E = mc^2" }),
  serialize: (c) => ({ source: c.latex }),
  deserialize: (source) => ({ latex: source }),
  toMarkdown: (c) => "$$\n" + c.latex.trim() + "\n$$",
};
