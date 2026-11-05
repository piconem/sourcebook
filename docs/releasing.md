[← Sourcebook](../README.md) · [Development](development.md) · [Docker](../docker/README.md) · [Release notes](releases/)

# Releasing — step by step

The checklist for publishing a version `X.Y.Z`: a git tag, a GitHub release with its notes and the Docker image on
GitHub Container Registry (GHCR). The background (version numbers, what the scripts check, doing it by hand) is in
[Development → Releasing](development.md#releasing) and [Docker → Publish](../docker/README.md#publish-ghcr).

Every block of commands below is typed in a **terminal** (shell), in the repository root folder — the one holding
`README.md`, `package.json` and `scripts/` — on the `main` branch:

```bash
cd path/to/sourcebook
git switch main
```

Examples use `0.2.0`: replace it with your version.

## Once only

Things to do the first time; later releases skip them.

1. **GitHub token for the Docker image.** GitHub → your picture → *Settings* → *Developer settings* →
   *Personal access tokens* → **Tokens (classic)** → *Generate new token (classic)*:
   - a **classic** token: GHCR does not accept fine-grained tokens for publishing images;
   - *Note*: e.g. `sourcebook ghcr push`; *Expiration*: e.g. 90 days;
   - scopes: only **`write:packages`** (`read:packages` is ticked with it); `delete:packages` only to be able to delete
     versions. `repo` is not needed.

   Copy it at once: GitHub does not show it again.
2. **Docker login to GHCR** (Docker then remembers it in `~/.docker/config.json`). Paste the token after the first
   command and press Enter — nothing is shown while you paste, and the token does not end up in the shell history:
   ```bash
   read -s GHCR_TOKEN && echo "$GHCR_TOKEN" | docker login ghcr.io -u piconem --password-stdin; unset GHCR_TOKEN
   ```
   It answers `Login Succeeded`. Repeat it when the token expires.
3. *(Optional)* **GitHub CLI**, to let the script create the GitHub release by itself: `sudo apt install gh`, then
   `gh auth login`. Without it you paste the notes on the web page (step 5).

The repository settings (step 8) and the package visibility (step 7) are also once only.

## 1. Version and release notes

**New version** (e.g. going from 0.2.0 to 0.3.0):

1. In a terminal, from the repository root, run:
   ```bash
   scripts/release.sh prepare 0.3.0
   ```
   (add `--date YYYY-MM-DD` for a release day other than today). It sets the version in
   `packages/shared/src/version.ts` with the date, in the five `package.json` files and in the README badge, adds the
   notes link to the README and drafts `docs/releases/0.3.0.md` with the commits since the last tag. It does not
   commit anything.
2. Open `docs/releases/0.3.0.md` in your editor and write the notes: remove every `TODO` and the commented list of
   commits (the script refuses to publish otherwise).
3. Check the changes in the terminal:
   ```bash
   git diff
   ```

**Version already prepared** (e.g. 0.2.0, whose version and notes are already in the repository): do not run
`prepare` — only check that the notes are complete and that `RELEASE_DATE` in `packages/shared/src/version.ts` is the
release day.

## 2. Check and commit

```bash
pnpm typecheck && pnpm test
git add -A
git status                       # check the list of files
git commit -m "Release 0.2.0"
```

## 3. Dry run

```bash
scripts/release.sh publish --dry-run
```

Every check must be OK: on `main`, clean working tree, versions in sync, tag not used yet, notes without `TODO`,
README link, `origin/main` behind the local branch. Nothing is changed.

## 4. Tag and push

```bash
scripts/release.sh publish
```

The script runs typecheck and tests again, shows what it will do, then asks:

1. **push** `main` and the tag `v0.2.0` → **yes**;
2. **Docker image** → **no** (step 6, calmly; or yes, if the once-only steps above are done).

With the GitHub CLI logged in, it also creates the GitHub release: skip step 5. Without it, it prints a **link** and
the **text of the notes**: keep them for step 5.

From here on the tag is public: **do not move or delete it**. Mistakes in the notes are fixed on GitHub; mistakes in
the code with a patch version (`X.Y.Z+1`).

## 5. GitHub release (without the GitHub CLI)

1. Open the link printed by the script: `https://github.com/piconem/sourcebook/releases/new?tag=v0.2.0`.
2. **Title:** `Sourcebook 0.2.0`.
3. **Description:** paste the notes printed by the script (the notes file without its first line: GitHub shows the
   title already). By hand: `tail -n +3 docs/releases/0.2.0.md`.
4. Leave **Set as the latest release** ticked (tick *Set as a pre-release* instead for a test version).
5. **Publish release**. GitHub attaches the source code (zip, tar.gz) by itself.

## 6. Docker image

1. **arm64 emulation** (needed to build the arm64 image on an amd64 PC; lost at every reboot — or install
   `qemu-user-static` once):
   ```bash
   docker run --privileged --rm tonistiigi/binfmt --install all
   ```
2. **Dry run, then publish** (amd64 + arm64, tags `:0.2.0` and `:latest`; a few minutes, arm64 is the slow part):
   ```bash
   docker/push.sh --dry-run
   docker/push.sh
   ```
   It uses the `docker login` of the once-only steps (or `GHCR_TOKEN`, or the GitHub CLI). It refuses uncommitted
   changes and versions already on GHCR.

## 7. Make the image public (first release only)

A new package on GHCR is **private**.

1. GitHub → your picture → *Your profile* → **Packages** → **sourcebook**.
2. *Package settings* → *Danger Zone* → **Change visibility** → **Public**, and confirm.
   ⚠️ **It cannot be undone**: a public package cannot become private again, only be deleted.
3. Check that the package shows the repository `piconem/sourcebook` (linked by the image label
   `org.opencontainers.image.source`).

Later versions stay public.

## 8. Repository page (first release only)

On the repository page: the ⚙ next to **About** (right column) → tick **Releases** and **Packages** → *Save changes*.
The latest release and the image then show in the right column; later releases appear there by themselves.

## 9. Check

```bash
docker logout ghcr.io
docker pull ghcr.io/piconem/sourcebook:0.2.0     # must work without a login
```

Then log in again (once-only step 2) for the next release. Also check on GitHub:

- *Releases* shows **Sourcebook 0.2.0** as *Latest*, with the notes;
- the right column of the repository shows the release and the package;
- *Packages* → `sourcebook` lists `0.2.0` and `latest`, for `linux/amd64` and `linux/arm64`.

## Summary

| # | What | Command / where |
|---|---|---|
| 1 | version and notes | terminal: `scripts/release.sh prepare X.Y.Z` (new versions only), then edit `docs/releases/X.Y.Z.md` |
| 2 | check and commit | `pnpm typecheck && pnpm test`, `git commit` |
| 3 | dry run | `scripts/release.sh publish --dry-run` |
| 4 | tag and push | `scripts/release.sh publish` |
| 5 | GitHub release | link printed by the script (or `gh`) |
| 6 | Docker image | `binfmt`, `docker/push.sh --dry-run`, `docker/push.sh` |
| 7 | image public | GitHub → Packages → sourcebook → Package settings (first time) |
| 8 | repository page | ⚙ About → Releases, Packages (first time) |
| 9 | check | `docker pull` without login, Releases page |
