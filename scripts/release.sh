#!/usr/bin/env bash
# Release helper for Sourcebook (see docs/development.md → Releasing). Two steps, with a review and your commit between:
#
#   scripts/release.sh prepare X.Y.Z [--date YYYY-MM-DD]
#       sets the version everywhere (version.ts, the five package.json, README badge), adds the release notes link to
#       the README and, when missing, creates docs/releases/X.Y.Z.md with a skeleton and the commits since the last
#       tag. Commits nothing: edit the notes, review `git diff`, then commit.
#
#   scripts/release.sh publish [--dry-run] [--no-docker] [--skip-checks] [--prerelease]
#       for the version now in the repository: checks (clean tree on main, versions in sync, notes written, tag
#       free, typecheck and tests), then tags vX.Y.Z, pushes main and the tag, creates the GitHub release with the
#       notes (GitHub CLI `gh`, or prints what to paste on the web) and, on request, publishes the Docker image
#       (docker/push.sh). Asks before anything leaves this machine. --dry-run only shows the steps.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
REPO_URL="https://github.com/piconem/sourcebook"
VERSION_TS="packages/shared/src/version.ts"
PACKAGES=(package.json packages/shared/package.json packages/server/package.json packages/client/package.json packages/mcp/package.json)

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
die() { echo "✗ $*" >&2; exit 1; }
ok() { echo "✓ $*"; }
confirm() {
  read -r -p "$1 [y/N] " answer
  [[ "$answer" =~ ^[yYsS]$ ]]
}

current_version() { sed -n 's/^export const APP_VERSION = "\([^"]*\)".*/\1/p' "$VERSION_TS"; }
semver_ok() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; }
# true when $1 > $2 (pre-release suffixes sort before the release, as in semver)
version_gt() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "${1/-/\~}" "${2/-/\~}" | sort -V | tail -1)" = "${1/-/\~}" ]; }
tag_exists() {
  git rev-parse -q --verify "refs/tags/v$1" >/dev/null ||
    { git remote get-url origin >/dev/null 2>&1 && git ls-remote --exit-code --tags origin "refs/tags/v$1" >/dev/null 2>&1; }
}

# Every place that holds the version, as "file: version" lines.
version_report() {
  echo "$VERSION_TS: $(current_version)"
  for f in "${PACKAGES[@]}"; do echo "$f: $(node -p "require('./$f').version")"; done
  echo "README.md badge: $(sed -n 's/.*badge\/version-\([^-]*\)-blue.*/\1/p' README.md | head -1)"
}

prepare() {
  local version="" date
  date="$(date +%Y-%m-%d)"
  while [ $# -gt 0 ]; do
    case "$1" in
      --date) date="${2:-}"; shift 2 ;;
      -h|--help) usage ;;
      -*) die "Unknown option: $1" ;;
      *) version="$1"; shift ;;
    esac
  done
  [ -n "$version" ] || usage 2
  semver_ok "$version" || die "\"$version\" is not a version X.Y.Z"
  [[ "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "--date must be YYYY-MM-DD"
  local current; current="$(current_version)"
  version_gt "$version" "$current" || die "$version is not above the current version $current"
  tag_exists "$version" && die "Tag v$version already exists"

  # Version and date
  sed -i -E "s/^(export const APP_VERSION = )\"[^\"]*\"/\1\"$version\"/; s/^(export const RELEASE_DATE = )\"[^\"]*\"/\1\"$date\"/" "$VERSION_TS"
  for f in "${PACKAGES[@]}"; do
    node -e '
      const fs = require("fs"), [f, v] = process.argv.slice(1);
      const text = fs.readFileSync(f, "utf8");
      fs.writeFileSync(f, text.replace(/("version":\s*")[^"]*(")/, `$1${v}$2`));
    ' "$f" "$version"
  done
  sed -i -E "s#badge/version-[^-]+-blue#badge/version-$version-blue#; s#alt=\"Version [^\"]*\"#alt=\"Version $version\"#" README.md
  ok "Version $current → $version ($date) in $VERSION_TS, ${#PACKAGES[@]} package.json, README badge"

  # Release notes link in the README Documentation table
  if ! grep -q "docs/releases/$version.md" README.md; then
    sed -i "s#what changed in each version: #what changed in each version: [$version](docs/releases/$version.md) · #" README.md
    ok "README: link to docs/releases/$version.md"
  fi

  # Release notes skeleton
  local notes="docs/releases/$version.md"
  if [ -f "$notes" ]; then
    ok "$notes already exists (left as it is)"
  else
    local since commits
    since="$(git describe --tags --abbrev=0 2>/dev/null || true)"
    if [ -n "$since" ]; then
      commits="$(git log --no-merges --format='- %s (%h)' "$since..HEAD")"
    else
      commits="(no previous tag: see git log)"
    fi
    cat > "$notes" <<EOF
# Sourcebook $version

*$date · TODO: one line on what this version is about.*

## Highlights
- TODO

## Changes
- TODO (group by area: Editor, Comments, AI assistant (MCP), Installation and deployment…)

## Fixes
- TODO

## Upgrading from $current
- Nothing to do. (TODO: or what must be done by hand.)

<!-- Commits since ${since:-the beginning}, to write the notes from (delete this block before publishing):
$commits
-->
EOF
    ok "$notes created: a skeleton with the commits since ${since:-the beginning}"
  fi

  cat <<EOF

Next:
  1. write $notes (remove every TODO and the commits block)
  2. review: git diff
  3. pnpm typecheck && pnpm test
  4. commit (e.g. git commit -am "Release $version"), then: scripts/release.sh publish
EOF
}

publish() {
  local dry=0 docker=1 checks=1 prerelease=0
  for arg in "$@"; do
    case "$arg" in
      --dry-run) dry=1 ;;
      --no-docker) docker=0 ;;
      --skip-checks) checks=0 ;;
      --prerelease) prerelease=1 ;;
      -h|--help) usage ;;
      *) die "Unknown option: $arg" ;;
    esac
  done
  local fail=0
  check() { if [ "$dry" = 1 ]; then echo "✗ $* (dry run: going on)" >&2; else die "$*"; fi; fail=1; }

  local version; version="$(current_version)"
  local tag="v$version" notes="docs/releases/$version.md"
  echo "Publishing Sourcebook $version ($tag)$([ "$dry" = 1 ] && echo " — dry run")"
  echo

  # Checks
  [ "$(git branch --show-current)" = "main" ] || check "Not on main (on $(git branch --show-current))"
  [ -z "$(git status --porcelain)" ] || check "Uncommitted changes: commit them first"
  if [ "$(version_report | awk -F': ' '{print $2}' | sort -u | wc -l)" != 1 ]; then
    version_report >&2
    check "The versions are not in sync: run scripts/release.sh prepare X.Y.Z"
  fi
  tag_exists "$version" && check "Tag $tag already exists: prepare a new version"
  [ -f "$notes" ] || check "$notes is missing: run scripts/release.sh prepare $version"
  if [ -f "$notes" ] && grep -qE 'TODO|<!-- Commits since' "$notes"; then check "$notes still has TODO or the commits block"; fi
  grep -q "docs/releases/$version.md" README.md || check "README.md does not link $notes"
  if git remote get-url origin >/dev/null 2>&1; then
    git fetch -q origin main 2>/dev/null || true
    if git rev-parse -q --verify origin/main >/dev/null && ! git merge-base --is-ancestor origin/main HEAD; then
      check "origin/main has commits that are not here: pull first"
    fi
  fi
  [ "$fail" = 1 ] || ok "Repository ready: main, clean, versions in sync, notes written, tag free"

  if [ "$checks" = 1 ]; then
    echo "+ pnpm typecheck && pnpm test"
    if [ "$dry" = 0 ]; then
      # Output kept in a log: on failure, its end (the failing test) is shown and the whole log stays for reading.
      local log="${TMPDIR:-/tmp}/sourcebook-release-checks.log"
      if (pnpm typecheck && pnpm test) >"$log" 2>&1; then
        ok "Typecheck and tests"
      else
        grep -E "FAIL|×|error TS|Error:" "$log" | head -30 >&2 || true
        echo "--- last lines of $log:" >&2
        tail -n 40 "$log" >&2
        die "Typecheck or tests failed (full output: $log)"
      fi
    fi
  fi

  local body; body="$(mktemp)"; trap "rm -f '$body'" EXIT
  [ -f "$notes" ] && tail -n +3 "$notes" > "$body"   # without "# Sourcebook X.Y.Z" and the blank line: GitHub shows the title

  local gh_ok=0
  command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 && gh_ok=1
  local gh_args=(release create "$tag" --title "Sourcebook $version" --notes-file "$body" --verify-tag)
  if [ "$prerelease" = 1 ]; then gh_args+=(--prerelease); else gh_args+=(--latest); fi

  echo
  echo "Steps:"
  echo "  git tag -a $tag -m \"Sourcebook $version\""
  echo "  git push origin main $tag"
  if [ "$gh_ok" = 1 ]; then echo "  gh ${gh_args[*]}"; else echo "  GitHub release on the web (no GitHub CLI login: the notes will be printed)"; fi
  [ "$docker" = 1 ] && echo "  docker/push.sh (asked separately)"
  echo
  if [ "$dry" = 1 ]; then echo "Dry run: nothing was tagged, pushed or published."; return; fi
  confirm "Tag and push $tag, and create the GitHub release?" || { echo "Cancelled."; exit 1; }

  git tag -a "$tag" -m "Sourcebook $version"
  git push origin main "$tag"
  ok "Pushed main and $tag"

  if [ "$gh_ok" = 1 ]; then
    gh "${gh_args[@]}"
    ok "GitHub release created: $REPO_URL/releases/tag/$tag"
  else
    cat <<EOF

Create the release on the web: $REPO_URL/releases/new?tag=$tag
  title: Sourcebook $version$([ "$prerelease" = 1 ] && echo "   (tick \"Set as a pre-release\")")
  notes: everything between the lines below (also in $notes, without its first line)
-----8<-----
$(cat "$body")
-----8<-----
EOF
  fi

  if [ "$docker" = 1 ] && confirm "Publish the Docker image ghcr.io/piconem/sourcebook:$version now?"; then
    docker/push.sh
  fi
  echo
  ok "Sourcebook $version released"
}

case "${1:-}" in
  prepare) shift; prepare "$@" ;;
  publish) shift; publish "$@" ;;
  -h|--help|"") usage ;;
  *) die "Unknown command: $1 (prepare or publish)" ;;
esac
