#!/usr/bin/env bash
# Builds the Sourcebook image locally (current platform) and tags it with the version and "latest".
#
#   docker/build.sh                  # sourcebook:<version> + sourcebook:latest, ghcr.io/piconem/sourcebook:<version> + :latest
#   docker/build.sh --no-cache       # extra arguments go to `docker build`
#   IMAGE=ghcr.io/me/sourcebook docker/build.sh
#
# The version is the one in package.json. Publishing is a separate step: docker/push.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-ghcr.io/piconem/sourcebook}"
VERSION="$(node -p "require('$ROOT/package.json').version" 2>/dev/null || sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -1)"
REVISION="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
if [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]; then REVISION="${REVISION}-dirty"; fi
CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Building Sourcebook ${VERSION} (${REVISION})"
DOCKER_BUILDKIT=1 docker build \
  -f "$ROOT/docker/Dockerfile" \
  --build-arg VERSION="$VERSION" \
  --build-arg REVISION="$REVISION" \
  --build-arg CREATED="$CREATED" \
  -t "sourcebook:${VERSION}" -t "sourcebook:latest" \
  -t "${IMAGE}:${VERSION}" -t "${IMAGE}:latest" \
  "$@" \
  "$ROOT"

echo
echo "Built: sourcebook:${VERSION}, ${IMAGE}:${VERSION} (and :latest)"
echo "Run it: cd docker && cp -n .env.example .env && docker compose up -d && docker compose logs -f"
