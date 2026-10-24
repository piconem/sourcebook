[← Sourcebook](../README.md) · [Installation](installation.md) · [Docker](../docker/README.md) · [User guide](user-guide.md) · [Collaboration](collaboration.md) · [AI assistant](ai-assistant.md) · [REST API](rest-api.md) · [File format](file-format.md) · [Development](development.md) · [Libraries](libraries.md)

# Installation and configuration

## Requirements (native)
- Node.js ≥ 22 and pnpm (`corepack enable`)
- Nothing else: document conversion for the assistant runs in Node; the only native part (`@napi-rs/canvas`, used to
  render PDF pages and figures) is a prebuilt binary that `pnpm install` downloads for your platform

## Run it with Node
```bash
git clone https://github.com/piconem/sourcebook.git
cd sourcebook
corepack enable      # provides pnpm
pnpm install
pnpm start           # builds the web client, then serves everything on http://127.0.0.1:4000/
```
`pnpm dev` starts the development setup instead (server on :4000 with reload + Vite client on http://localhost:5173).

The workspace folder holds all projects and templates, plus `.sourcebook/` with accounts and settings. Missing
folders are created automatically, and the **Sourcebook Demo** template is added at the first start (see
[Templates](user-guide.md#templates)).

## Run it with Docker
```bash
docker/build.sh                     # builds the image (until it is published on GHCR)
cd docker
cp .env.example .env                # data folder, port, base path, public URL…
mkdir -p data
docker compose up -d
docker compose logs sourcebook      # first start: owner username and password
```
Everything about the image, the compose file, reverse proxies and publishing: [docker/README.md](../docker/README.md).

## First start
An **owner** account is created — `admin`, or the profile of an older single-user Sourcebook. Its password is
`SOURCEBOOK_ADMIN_PASSWORD`, or a generated one printed **once** in the server log; it must be changed at the first
sign-in. Forgot it? `pnpm --filter @sourcebook/server reset-owner-password [--workspace dir]` prints a new temporary
one (then restart the server; with Docker see [docker/README.md](../docker/README.md)).

Then sign in, choose a new password, and add people and agents: see [Collaboration](collaboration.md).

## Configuration
Command-line option, else environment variable, else default:

| Option / variable | Default | |
|---|---|---|
| `--workspace` / `SOURCEBOOK_WORKSPACE` | `~/Sourcebook` | where Sourcebook works: projects, templates, `.sourcebook/` |
| `--host` / `SOURCEBOOK_HOST` | `127.0.0.1` | interface to listen on (`0.0.0.0` to accept other machines, e.g. in a container) |
| `--port` / `PORT` | `4000` | port — the only one: web interface, REST API (`/api`) and MCP server (`/mcp`) share it |
| `--base-path` / `SOURCEBOOK_BASE_PATH` | `/` | URL prefix, e.g. `/marco/sourcebook` for `https://mydomain.it/marco/sourcebook/` behind a reverse proxy |
| `--public-url` / `SOURCEBOOK_PUBLIC_URL` | `http://127.0.0.1:<port><base>` | address users reach (shown in MCP connection hints; `https` makes the session cookie `Secure`) |
| `SOURCEBOOK_ADMIN_PASSWORD` | generated | password of the owner account created at the first start |
| `SOURCEBOOK_TRUST_PROXY=1` | off | behind a reverse proxy: trust `X-Forwarded-*` (client IP for sign-in throttling) |

One client build works under any base path (relative asset URLs; the server tells the page its prefix). In development
`SOURCEBOOK_BASE_PATH` is read by Vite as well. Several Sourcebooks can share a domain under different prefixes: each
has its own session cookie.
