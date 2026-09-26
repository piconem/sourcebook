import { z } from "zod";
import { CODE_LANGUAGES, fenceFor, languageByExt, languageById } from "../languages.js";
import type { SubBlockTypeCore } from "../registry.js";

const schema = z.object({
  language: z.string().refine((id) => !!languageById(id), "Unknown language"),
  code: z.string(),
});
export type CodeContent = z.infer<typeof schema>;

/** A source file in its own language: stored as NN-code.<ext>, so the extension carries the language. */
export const codeType: SubBlockTypeCore<CodeContent> = {
  type: "code",
  label: "Code",
  sourceExt: "ts",
  commentAnchor: "lines",
  sourceExtFor: (c) => languageById(c.language)?.ext ?? "txt",
  contentSchema: schema,
  defaultContent: () => ({ language: "typescript", code: "" }),
  serialize: (c) => ({ source: c.code }),
  deserialize: (source, _assets, ctx) => ({
    language: (ctx && languageByExt(ctx.sourceExt)?.id) ?? CODE_LANGUAGES[0].id,
    code: source,
  }),
  toMarkdown: (c) => {
    const fence = fenceFor(c.code);
    const lang = c.language === "plaintext" ? "" : c.language;
    return `${fence}${lang}\n${c.code.replace(/\n$/, "")}\n${fence}`;
  },
};
