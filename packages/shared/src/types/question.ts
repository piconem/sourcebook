import { z } from "zod";
import type { SubBlockTypeCore } from "../registry.js";

const schema = z.object({ question: z.string(), answer: z.string() });
export type QuestionContent = z.infer<typeof schema>;

/** Reads a stored question; a file that is not valid JSON (e.g. edited by hand) becomes the question text. */
function parse(source: string): QuestionContent {
  try {
    const raw = JSON.parse(source) as Partial<QuestionContent>;
    return { question: String(raw.question ?? ""), answer: String(raw.answer ?? "") };
  } catch {
    return { question: source, answer: "" };
  }
}

/** One question and its answer (both free text). */
export const questionType: SubBlockTypeCore<QuestionContent> = {
  type: "question",
  label: "Question",
  sourceExt: "json",
  contentSchema: schema,
  defaultContent: () => ({ question: "", answer: "" }),
  serialize: (c) => ({ source: JSON.stringify({ question: c.question, answer: c.answer }, null, 2) + "\n" }),
  deserialize: parse,
  toMarkdown: (c) => `**Q:** ${c.question.trim() || "_(no question)_"}\n\n**A:** ${c.answer.trim() || "_No answer yet_"}`,
};
