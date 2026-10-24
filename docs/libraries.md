[← Sourcebook](../README.md) · [Installation](installation.md) · [Docker](../docker/README.md) · [User guide](user-guide.md) · [Collaboration](collaboration.md) · [AI assistant](ai-assistant.md) · [REST API](rest-api.md) · [File format](file-format.md) · [Development](development.md) · [Libraries](libraries.md) · [Screenshots](screenshots.md)

# Libraries and licenses
Sourcebook is built on these open-source libraries (direct dependencies; versions in each `package.json`). All of
them are under permissive licenses (MIT, Apache-2.0, BSD, ISC).

**Web client** (`packages/client`)

| Library | Used for | License |
|---|---|---|
| [React](https://react.dev) 18 | user interface | MIT |
| [TanStack Query](https://tanstack.com/query) | data fetching and caching from the REST API | MIT |
| [TipTap](https://tiptap.dev) (core, starter kit, tables, images, code blocks, Markdown) on [ProseMirror](https://prosemirror.net) | rich-text editor of Markdown sub-blocks | MIT |
| [lowlight](https://github.com/wooorm/lowlight) + [highlight.js](https://highlightjs.org) | syntax highlighting of code inside Markdown | MIT · BSD-3-Clause |
| [CodeMirror 6](https://codemirror.net) (+ `@codemirror/language-data`, Lezer) | code, Mermaid, LaTeX and CSV source editors | MIT |
| [Mermaid](https://mermaid.js.org) | diagrams from text | MIT |
| [Excalidraw](https://excalidraw.com) | hand-drawn sketches | MIT |
| [KaTeX](https://katex.org) | LaTeX equations | MIT |
| [dnd-kit](https://dndkit.com) | drag and drop in the outline and between sub-blocks | MIT |
| [html-to-image](https://github.com/bubkoo/html-to-image) | PNG export of rendered equations | MIT |
| [Vite](https://vite.dev) + `@vitejs/plugin-react` | development server and build (not shipped) | MIT |

**Server** (`packages/server`)

| Library | Used for | License |
|---|---|---|
| [Fastify](https://fastify.dev) 5 (+ `@fastify/static`, `@fastify/multipart`, `fastify-type-provider-zod`) | HTTP server, REST API, uploads, static files | MIT |
| [Zod](https://zod.dev) 4 | schemas and validation, shared with client and MCP | MIT |
| [unified](https://unifiedjs.com) / [remark](https://remark.js.org) (`remark-parse`, `remark-stringify`, `remark-gfm`, `remark-math`) | Markdown parsing, validation and normalization | MIT |
| [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) (Skia) | profile pictures, PDF pages rendered as images, images scaled for the assistant | MIT |
| [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | text and figures of PDF references | Apache-2.0 |
| [mammoth](https://github.com/mwilliamson/mammoth.js), [word-extractor](https://github.com/morungos/node-word-extractor) | Word documents (`.docx`, `.doc`) → Markdown | BSD-2-Clause · MIT |
| [ExcelJS](https://github.com/exceljs/exceljs) | spreadsheets → Markdown tables | MIT |
| [mailparser](https://nodemailer.com/extras/mailparser/), [@kenjiuno/msgreader](https://github.com/HiraokaHyperTools/msgreader) | e-mails (`.eml`, `.msg`) → Markdown | MIT · Apache-2.0 |
| [Turndown](https://github.com/mixmark-io/turndown) + GFM plugin | HTML → Markdown | MIT |
| [@xmldom/xmldom](https://github.com/xmldom/xmldom) | OpenDocument / OOXML / EPUB contents (XML) | MIT |
| [fflate](https://github.com/101arrowz/fflate) | ZIP archives (templates, exports, document containers) | MIT |
| [nanoid](https://github.com/ai/nanoid) | ids of sections, sub-blocks and comments | MIT |
| [tsx](https://tsx.is) | runs the TypeScript sources | MIT |

**MCP server** (`packages/mcp`): the [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) (MIT) and Zod.

**Development**: [TypeScript](https://www.typescriptlang.org) (Apache-2.0), [Vitest](https://vitest.dev) and
[jsdom](https://github.com/jsdom/jsdom) (MIT), `pdf-lib` for test fixtures (MIT).

Indirect dependencies and bundled assets, in short: almost all MIT / ISC / BSD / Apache-2.0; fonts of KaTeX and
Excalidraw under MIT or SIL OFL 1.1; `elkjs` (Mermaid's default layout engine, EPL-2.0, shipped unmodified as a separate file); libraries offered under a
choice of licenses (`jszip` MIT or GPL-3.0, `dompurify` MPL-2.0 or Apache-2.0, `@zone-eu/mailsplit` MIT or EUPL) are
used under their permissive option. `pnpm licenses list` (add `--json` for details) prints the complete list;
`node scripts/third-party-licenses.mjs` writes it with the license texts (also run by `pnpm build`).

## License of Sourcebook
Sourcebook is released under the [MIT License](../LICENSE): use, modify and redistribute it freely, also in other
products, keeping the copyright notice. It comes without any warranty.

The libraries it ships keep their own licenses (above). `pnpm build` writes their notices and
license texts into `packages/client/dist/THIRD_PARTY_LICENSES.txt`, served with the app (*About → Third-party licenses*)
and included in the Docker image.
