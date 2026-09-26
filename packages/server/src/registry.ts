import { coreTypes, createRegistry, markdownType, type SubBlockTypeCore } from "@sourcebook/shared";
import { markdownAnchorText } from "./markdown/plainText.js";
import { validateMarkdown } from "./markdown/remark.js";

/** Server registry: the shared core types, with server-only validation hooks attached. */
export function createServerRegistry() {
  const serverOverrides: Record<string, Partial<SubBlockTypeCore<any>>> = {
    [markdownType.type]: {
      validate: (c: { markdown: string }) => validateMarkdown(c.markdown),
      anchorText: markdownAnchorText,
    },
  };
  return createRegistry(coreTypes.map((t) => ({ ...t, ...serverOverrides[t.type] })));
}
