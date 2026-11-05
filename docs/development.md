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
scripts/          release, example templates, third-party licenses
```

## Version
Name, version and release date live in `packages/shared/src/version.ts` (shown in the user menu → About
and reported by the MCP server); keep `version` in the `package.json` files and the version badge at the top of `README.md` in sync when releasing, and
write the release notes in `docs/releases/<version>.md` (the text of the GitHub release). See [Releasing](#releasing).

## Releasing
Versions follow [semantic versioning](https://semver.org/) (`0.MINOR.PATCH` while Sourcebook is below 1.0: a new
minor for new features or changes that need attention when upgrading, a patch for fixes only). A release is a git tag
`vX.Y.Z`, a GitHub release with its notes and, optionally, the Docker image on GitHub Container Registry.

**Step-by-step checklist** (token, Docker login, publishing, making the image public, checks):
[releasing.md](releasing.md). This section explains what the scripts do.

`scripts/release.sh` does the steps below in two commands, with your review and commit in between:
```bash
scripts/release.sh prepare 0.3.0        # steps 1–2: versions, README, notes skeleton (commits since the last tag)
#   … write docs/releases/0.3.0.md, review git diff, pnpm typecheck && pnpm test, commit …
scripts/release.sh publish --dry-run    # shows checks and steps, changes nothing
scripts/release.sh publish              # steps 3–6: checks, tag, push, GitHub release, Docker image (asked)
```
`publish` refuses a dirty tree, a branch other than `main`, versions out of sync, notes with `TODO`, an existing tag
or failing tests, and asks before pushing. Without the GitHub CLI (`gh auth login`) it prints the release page link
and the notes to paste. Options: `--no-docker`, `--prerelease`, `--skip-checks`; `prepare --date YYYY-MM-DD`.

By hand:

1. **Version.** Set the same `X.Y.Z` in:
   - `packages/shared/src/version.ts` (`APP_VERSION`, and `RELEASE_DATE` as `YYYY-MM-DD`);
   - the five `package.json` files (root, `packages/shared`, `server`, `client`, `mcp`);
   - the version badge at the top of `README.md`.

   `grep -rn '"version"' package.json packages/*/package.json` lists them.
2. **Release notes.** Write `docs/releases/X.Y.Z.md` (same structure as the previous ones: date and one-line summary,
   *Highlights*, sections per area, *Upgrading from …* when something must be done by hand) and add it to the
   *Release notes* row of the Documentation table in `README.md`.
3. **Check.** `pnpm typecheck && pnpm test`, and `docker/build.sh` if the image is published.
4. **Commit and tag** (on `main`, clean working tree):
   ```bash
   git commit -am "Release X.Y.Z"
   git tag -a vX.Y.Z -m "Sourcebook X.Y.Z"
   git push origin main vX.Y.Z
   ```
5. **GitHub release.** Either on the web — repository → *Releases* → *Draft a new release*, choose the tag `vX.Y.Z`,
   title `Sourcebook X.Y.Z`, paste the notes **without their first line** (the `# Sourcebook X.Y.Z` heading: GitHub
   shows the title already) — or with the GitHub CLI:
   ```bash
   tail -n +3 docs/releases/X.Y.Z.md > /tmp/notes.md
   gh release create vX.Y.Z --title "Sourcebook X.Y.Z" --notes-file /tmp/notes.md --latest
   ```
   Add `--prerelease` for a test version. GitHub attaches the source code (zip, tar.gz) by itself.
6. **Docker image** (optional): `docker/push.sh --dry-run`, then `docker/push.sh` — see
   [Publish (GHCR)](../docker/README.md#publish-ghcr). It refuses uncommitted changes and versions already on GHCR.

**Once only**, on the repository page: the ⚙ next to *About* (right column) → tick *Releases* and *Packages*, so the
latest release and the container image show in the right column. A release created later appears there by itself.

Fixing a release: edit its notes on GitHub (and in `docs/releases/`) at any time. A tag already pushed should not be
moved — publish a patch version (`X.Y.Z+1`) instead.

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
