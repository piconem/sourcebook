import type { AnyExtension, Extensions } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";

export const lowlight = createLowlight(common);

/** Code blocks highlighted with lowlight; the fence info string (```python) is the language. */
export const codeBlock = CodeBlockLowlight.configure({ lowlight, defaultLanguage: null });

/**
 * TipTap is scoped to editing one Markdown sub-block: no block/side-menu/slash-menu features.
 * Markdown bridge: @tiptap/markdown (see docs/decisions.md). The code block extension is
 * injectable so the React editor can add its language-picker node view.
 */
export const markdownExtensions = (codeBlockExtension: AnyExtension = codeBlock): Extensions => [
  StarterKit.configure({
    // bib:key links are citations of bibliography entries.
    link: { openOnClick: false, isAllowedUri: (url, ctx) => url.startsWith("bib:") || ctx.defaultValidate(url) },
    codeBlock: false,
  }),
  codeBlockExtension,
  Image,
  TableKit,
  Markdown,
];
