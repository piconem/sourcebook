#!/usr/bin/env bash
# Publishes the Sourcebook image to the GitHub Container Registry (GHCR), for linux/amd64 and linux/arm64.
#
#   docker/push.sh --dry-run         # shows what it would do, pushes nothing
#   docker/push.sh                   # builds and pushes ghcr.io/piconem/sourcebook:<version> and :latest
#   docker/push.sh --no-latest       # only :<version>
#
# Login: GHCR_TOKEN (a GitHub token with the write:packages scope) and GHCR_USER, or the token of the GitHub CLI
# (`gh auth token`, after `gh auth refresh -s write:packages`), or an existing `docker login ghcr.io`.
# Images are private on GHCR at first: make the package public in its GitHub settings to let anyone pull it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-ghcr.io/piconem/sourcebook}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
REGISTRY="${IMAGE%%/*}"
DRY_RUN=0
LATEST=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-latest) LATEST=0 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

run() {
  echo "+ $*"
  if [ "$DRY_RUN" = 0 ]; then "$@"; fi
}

VERSION="$(node -p "require('$ROOT/package.json').version" 2>/dev/null || sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
REVISION="$(git -C "$ROOT" rev-parse --short HEAD)"
CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Only clean, committed sources are published, and a version is published once.
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "The working tree has uncommitted changes: commit them first." >&2
  [ "$DRY_RUN" = 1 ] || exit 1
fi
if docker manifest inspect "${IMAGE}:${VERSION}" >/dev/null 2>&1; then
  echo "${IMAGE}:${VERSION} already exists: raise the version in package.json first." >&2
  [ "$DRY_RUN" = 1 ] || exit 1
fi

TAGS=(-t "${IMAGE}:${VERSION}")
[ "$LATEST" = 1 ] && TAGS+=(-t "${IMAGE}:latest")

echo "Publishing ${IMAGE}:${VERSION}$([ "$LATEST" = 1 ] && echo " and :latest") (${REVISION}) for ${PLATFORMS}"
if [ "$DRY_RUN" = 0 ]; then
  read -r -p "Continue? [y/N] " answer
  [[ "$answer" =~ ^[yYsS]$ ]] || { echo "Cancelled."; exit 1; }
fi

# Login
if [ -n "${GHCR_TOKEN:-}" ]; then
  echo "+ docker login ${REGISTRY} -u ${GHCR_USER:-piconem} --password-stdin"
  [ "$DRY_RUN" = 1 ] || echo "$GHCR_TOKEN" | docker login "$REGISTRY" -u "${GHCR_USER:-piconem}" --password-stdin
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "+ gh auth token | docker login ${REGISTRY} -u <gh user> --password-stdin"
  [ "$DRY_RUN" = 1 ] || gh auth token | docker login "$REGISTRY" -u "$(gh api user -q .login)" --password-stdin
else
  echo "No GHCR_TOKEN and no GitHub CLI login: using the existing docker login for ${REGISTRY}."
fi

# A buildx builder able to build for several platforms (QEMU emulation for the other architecture).
if ! docker buildx inspect sourcebook-multiarch >/dev/null 2>&1; then
  run docker buildx create --name sourcebook-multiarch --driver docker-container
fi

# Building for another architecture needs QEMU emulation registered in the kernel (once per machine).
if [ "$DRY_RUN" = 0 ]; then
  supported="$(docker buildx inspect sourcebook-multiarch --bootstrap | sed -n 's/^Platforms: *//p')"
  for p in ${PLATFORMS//,/ }; do
    if [[ ", ${supported}," != *", ${p},"* && ", ${supported}," != *", ${p}*,"* ]]; then
      echo "The builder cannot build ${p}. Enable emulation once with:" >&2
      echo "  docker run --privileged --rm tonistiigi/binfmt --install all" >&2
      exit 1
    fi
  done
fi

run docker buildx build \
  --builder sourcebook-multiarch \
  --platform "$PLATFORMS" \
  -f "$ROOT/docker/Dockerfile" \
  --build-arg VERSION="$VERSION" \
  --build-arg REVISION="$REVISION" \
  --build-arg CREATED="$CREATED" \
  "${TAGS[@]}" \
  --push \
  "$ROOT"

echo
if [ "$DRY_RUN" = 1 ]; then
  echo "Dry run: nothing was built or pushed."
else
  echo "Published. Pull it with: docker pull ${IMAGE}:${VERSION}"
fi
