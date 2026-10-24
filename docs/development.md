[← Sourcebook](../README.md) · [Installation](installation.md) · [Docker](../docker/README.md) · [User guide](user-guide.md) · [Collaboration](collaboration.md) · [AI assistant](ai-assistant.md) · [REST API](rest-api.md) · [File format](file-format.md) · [Development](development.md) · [Libraries](libraries.md) · [Screenshots](screenshots.md)

# Development

## Commands
```bash
pnpm install
pnpm dev          # server on :4000 (workspace ~/Sourcebook) + Vite client on http://localhost:5173
pnpm start        # builds the client, then serves everything from the server (http://127.0.0.1:4000/)
pnpm build        # web client + THIRD_PARTY_LICENSES.txt
pnpm test         # vitest in all packages
pnpm typecheck
```

## Repository layout
```
packages/shared   zod schemas, shared types, sub-block registry contract + core type definitions
packages/server   Fastify REST API, filesystem stores, remark (validation + combined Markdown)
packages/client   React + Vite UI: home (projects/templates), outline (dnd-kit), TipTap, mermaid, Excalidraw, KaTeX
packages/mcp      MCP server for LLM assistants (tools, resources, prompts; stdio binary + library used by /mcp)
```
```
docker/           container image, build / publish scripts, docker compose
docs/             documentation (decisions.md: implementation choices and known limitations)
scripts/          example templates, third-party licenses
```

## Version
Name, version and release date live in `packages/shared/src/version.ts` (shown in the user menu → About
and reported by the MCP server); keep `version` in the `package.json` files and the version badge at the top of `README.md` in sync when releasing.

## Adding a sub-block type
1. `packages/shared/src/types/<type>.ts`: a `SubBlockTypeCore` (zod content schema, source extension,
   serialize/deserialize, `toMarkdown`, optional `sourceExtFor`, `assetsOf`, `commentAnchor`), added to `coreTypes`.
2. `packages/client/src/subblocks/index.ts`: register it with its React `component`
   (and optional `exportArtifacts`).

No block, reorder or REST code changes are needed.

See [decisions.md](decisions.md) for implementation choices and known limitations.

## Example templates
The bundled templates are built by the server at its first start (`packages/server/src/seed/`):

- **Sourcebook Demo**: code, in `demoTemplate.ts` (a test checks it covers every sub-block type);
- **Software Project**, **Scientific Paper**, **Research Project Proposal**, **Thesis**: data, in
  `templates/<id>.json` — sections (`title`, `objective`, `subs`, `children`) whose sub-blocks are the bodies of
  `POST …/subblocks` (`type`, `title`, `objective`, `content`).

To refresh them in a workspace after editing the JSON, against a running server:
`SOURCEBOOK_TOKEN=sbu_… python3 scripts/create-example-templates.py --replace [--only <id>…]` (an owner's access token,
from Settings → My agents). It reads the same JSON files.
