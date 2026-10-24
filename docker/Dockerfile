# syntax=docker/dockerfile:1.7
#
# Sourcebook container image. Build context: the repository root.
#   docker build -f docker/Dockerfile -t sourcebook .      (or docker/build.sh)
#
# Data: everything (projects, templates, accounts in .sourcebook/) lives in the workspace volume, /data.

ARG NODE_VERSION=24
ARG PNPM_VERSION=12.6.0

# ---------------------------------------------------------------- base: Node + pnpm
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install -g "pnpm@${PNPM_VERSION}" && pnpm --version
WORKDIR /app

# ---------------------------------------------------------------- build: all dependencies, web client
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/mcp/package.json packages/mcp/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY packages packages
COPY scripts/third-party-licenses.mjs scripts/
# Web client + THIRD_PARTY_LICENSES.txt (licenses of every shipped library) in packages/client/dist
RUN pnpm build

# ---------------------------------------------------------------- prod: runtime dependencies of the server only
FROM base AS prod
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/mcp/package.json packages/mcp/
COPY packages/server/package.json packages/server/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter "@sourcebook/server..." install --frozen-lockfile --prod

# ---------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.title="Sourcebook" \
      org.opencontainers.image.description="Block-based notebook written together by people and AI assistants (MCP)" \
      org.opencontainers.image.source="https://github.com/piconem/sourcebook" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}"

# SOURCEBOOK_CONTAINER: no MCP over stdio here (an AI client cannot start a process inside the container); HTTP only.
ENV NODE_ENV=production \
    SOURCEBOOK_CONTAINER=1 \
    SOURCEBOOK_WORKSPACE=/data \
    SOURCEBOOK_HOST=0.0.0.0 \
    PORT=4000 \
    SOURCEBOOK_CLIENT_DIST=/app/packages/client/dist
WORKDIR /app

COPY --from=prod /app/node_modules node_modules
COPY --from=prod /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=prod /app/packages/mcp/node_modules packages/mcp/node_modules
COPY --from=prod /app/packages/server/node_modules packages/server/node_modules
COPY package.json LICENSE ./
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/mcp/package.json packages/mcp/
COPY packages/mcp/src packages/mcp/src
COPY packages/server/package.json packages/server/
COPY packages/server/src packages/server/src
COPY --from=build /app/packages/client/dist packages/client/dist

# Runs as the unprivileged "node" user (uid/gid 1000); /data must be writable by it.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4000

# Any HTTP answer (401 when signed out) means the server is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+(process.env.SOURCEBOOK_BASE_PATH||'').replace(/\/+$/,'')+'/api/auth/me').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"

# tsx runs the TypeScript sources (as `pnpm start` does); node stays PID 1 and handles SIGTERM.
WORKDIR /app/packages/server
CMD ["node", "--import", "tsx", "src/index.ts"]
