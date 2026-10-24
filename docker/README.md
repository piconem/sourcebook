# Sourcebook in Docker

| File | |
|---|---|
| `Dockerfile` | the image (build context: the repository root) |
| `Dockerfile.dockerignore` | what the build does not send to Docker |
| `build.sh` | builds the image locally and tags it `sourcebook:<version>` and `ghcr.io/piconem/sourcebook:<version>` (+ `:latest`) |
| `docker-compose.yml` + `.env.example` | runs it; every setting comes from `.env` |
| `push.sh` | publishes the image on GitHub Container Registry for amd64 and arm64 (`--dry-run` to see what it would do) |

The version is the one in the root `package.json`.

## Build and run

```bash
docker/build.sh                      # → sourcebook:0.2.0, ghcr.io/piconem/sourcebook:0.2.0 (+ :latest)

cd docker
cp .env.example .env                 # adjust it: data folder, port, base path, public URL…
mkdir -p data                        # before the first start, so it belongs to you and not to root
docker compose up -d
docker compose logs sourcebook       # first start: owner username and password
```

Open `http://127.0.0.1:4000/`, sign in as the owner and choose a new password. The workspace starts with the
**Sourcebook Demo** template.

- **Data**: everything is in the folder mounted on `/data` (`SOURCEBOOK_DATA`, default `docker/data`): projects,
  templates and `.sourcebook/` (accounts, password hashes, sessions, tokens, settings). Recreating or upgrading the
  container keeps it; back up that folder. To use an existing workspace, point `SOURCEBOOK_DATA` at it (e.g.
  `~/Sourcebook`), with `SOURCEBOOK_UID`/`SOURCEBOOK_GID` set to its owner (`id -u`, `id -g`).
- **One port**: the web interface, the REST API (`/api`) and the MCP server for AI assistants (`/mcp`) are served by
  the same server on the same port (`SOURCEBOOK_PORT` on the host): with port 4500 the MCP address is
  `http://127.0.0.1:4500/mcp`. Set `SOURCEBOOK_PUBLIC_URL` to match, since the ready-made MCP command in *Settings → AI
  assistant* is built from it. Behind a proxy the MCP follows the base path too (`https://mydomain.it/marco/sourcebook/mcp`).
- **User**: the container runs as `SOURCEBOOK_UID:SOURCEBOOK_GID` (default 1000:1000), never as root.
- **Upgrade**: build or pull the new image, then `docker compose up -d`.
- **Owner password lost**: `docker compose exec sourcebook node --import tsx src/resetOwnerPassword.ts` prints a
  temporary one; then `docker compose restart`.

## Windows (and macOS)

The image is the same Linux image: Docker Desktop runs it in a light virtual machine (WSL 2 on Windows). What changes
is around it (not tested on Windows yet):

- **Scripts**: `build.sh` and `push.sh` are bash scripts. Run them from WSL (e.g. Ubuntu) or Git Bash, or build from
  PowerShell directly, which is all `build.sh` does:
  ```powershell
  docker build -f docker/Dockerfile -t ghcr.io/piconem/sourcebook:0.2.0 -t ghcr.io/piconem/sourcebook:latest .
  ```
  With a published image no build is needed: `docker compose up -d` works the same from PowerShell.
- **Line endings**: `.gitattributes` keeps `.sh`, the Dockerfile and the compose files with LF line endings even on a
  Windows checkout (with CRLF a script fails with `/usr/bin/env: 'bash\r': No such file or directory`).
- **Data folder** in `.env`, with forward slashes:
  ```dotenv
  SOURCEBOOK_DATA=C:/Users/marco/Sourcebook
  ```
  A Windows folder works but is slow: every file access crosses from Windows into the virtual machine, and Sourcebook
  writes many small files. Faster: keep the workspace in the WSL file system (e.g. `/home/marco/Sourcebook` in
  Ubuntu, reachable from Explorer as `\\wsl$\Ubuntu\home\marco\Sourcebook`) and run compose from WSL; or use a
  Docker-managed volume (fastest, but its files are reachable only through Docker).
- **UID / GID**: ignored on a Windows folder (permissions are emulated; the default 1000:1000 is fine). In the WSL file
  system they matter as on Linux; the WSL user is almost always 1000.
- **Network**: same addresses (`http://localhost:4000`, MCP at `http://127.0.0.1:4000/mcp`). With
  `SOURCEBOOK_BIND=0.0.0.0` Windows Firewall may ask to allow the port.
- **ARM PCs** (Windows on ARM, Apple Silicon Macs) need the arm64 image, built by `push.sh`.

## Behind a reverse proxy, under a path

E.g. `https://mydomain.it/marco/sourcebook/`:

```dotenv
SOURCEBOOK_BIND=127.0.0.1
SOURCEBOOK_PORT=4000
SOURCEBOOK_BASE_PATH=/marco/sourcebook
SOURCEBOOK_PUBLIC_URL=https://mydomain.it/marco/sourcebook
SOURCEBOOK_TRUST_PROXY=true
```

The proxy forwards `/marco/sourcebook/` to `http://127.0.0.1:4000/marco/sourcebook/` **keeping the prefix**, and must
not buffer `…/api/…/events` (live updates, Server-Sent Events). Caddy:

```
mydomain.it {
  handle /marco/sourcebook* {
    reverse_proxy 127.0.0.1:4000 { flush_interval -1 }
  }
}
```

nginx:

```nginx
location /marco/sourcebook/ {
  proxy_pass http://127.0.0.1:4000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_buffering off;
  proxy_read_timeout 1h;
  client_max_body_size 60m;
}
```

Several instances on the same domain (`/marco/sourcebook`, `/luca/sourcebook`) are separate compose projects with
their own `.env` (container name, port, data folder, base path); their sign-in cookies do not mix.

AI assistants connect to `<SOURCEBOOK_PUBLIC_URL>/mcp` with a personal access token: *Settings → AI assistant* shows the
ready-made command.

## Publish (GHCR)

Not done automatically. When a version is ready (committed, version raised in `package.json`):

```bash
docker/push.sh --dry-run             # checks and shows the commands
export GHCR_TOKEN=<GitHub token with write:packages>   # or: gh auth refresh -s write:packages
docker/push.sh                       # builds amd64 + arm64 and pushes :<version> and :latest
```

It refuses uncommitted changes and versions already published. Building arm64 on an amd64 machine needs QEMU once:
`docker run --privileged --rm tonistiigi/binfmt --install all`. A new package on GHCR is private: make it public in
its settings on GitHub so that anyone can `docker pull ghcr.io/piconem/sourcebook`.
