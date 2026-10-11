import { z } from "zod";
import type { SubBlockTypeCore } from "../registry.js";

const optionSchema = z.object({ id: z.string().min(1).max(64), text: z.string() });
const schema = z.object({
  question: z.string(),
  /** "single": at most one option can be selected; "multiple": any number. */
  mode: z.enum(["single", "multiple"]),
  options: z.array(optionSchema).max(100),
  /** Ids of the selected options. */
  selected: z.array(z.string()),
  /** Free-text note about the choice (e.g. why it was made). */
  note: z.string(),
});
export type ChoiceContent = z.infer<typeof schema>;
export type ChoiceOption = z.infer<typeof optionSchema>;

/** Multiple-choice question: a list of options, single or multiple selection, and a note. */
export const choiceType: SubBlockTypeCore<ChoiceContent> = {
  type: "choice",
  label: "Multiple choice",
  sourceExt: "json",
  contentSchema: schema,
  defaultContent: () => ({
    question: "",
    mode: "single",
    options: [
      { id: "a", text: "Option A" },
      { id: "b", text: "Option B" },
    ],
    selected: [],
    note: "",
  }),
  serialize: (c) =>
    ({ source: JSON.stringify({ question: c.question, mode: c.mode, options: c.options, selected: c.selected, note: c.note }, null, 2) + "\n" }),
  deserialize: (source) => schema.parse(JSON.parse(source)),
  validate(c) {
    const errors: string[] = [];
    const ids = new Set(c.options.map((o) => o.id));
    if (ids.size !== c.options.length) errors.push("Option ids must be unique");
    const unknown = c.selected.filter((id) => !ids.has(id));
    if (unknown.length) errors.push(`Selected options do not exist: ${unknown.join(", ")}`);
    if (new Set(c.selected).size !== c.selected.length) errors.push("An option is selected twice");
    if (c.mode === "single" && c.selected.length > 1) errors.push("Only one option can be selected (single answer)");
    return errors.length ? { ok: false, errors } : { ok: true };
  },
  toMarkdown(c) {
    const selected = new Set(c.selected);
    const lines = [
      `**${c.question.trim() || "(no question)"}** _(${c.mode === "single" ? "single answer" : "multiple answers"})_`,
      "",
      ...c.options.map((o) => `- [${selected.has(o.id) ? "x" : " "}] ${o.text}`),
    ];
    if (c.note.trim()) lines.push("", `> ${c.note.trim().replace(/\n/g, "\n> ")}`);
    return lines.join("\n");
  },
};
