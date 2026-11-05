# Sourcebook in Docker

| File | |
|---|---|
| `Dockerfile` | the image (build context: the repository root) |
| `Dockerfile.dockerignore` | what the build does not send to Docker |
| `build.sh` | builds the image locally and tags it `sourcebook:<version>` and `ghcr.io/piconem/sourcebook:<version>` (+ `:latest`) |
| `docker-compose.yml` + `.env.example` | runs it; every setting comes from `.env` |
| `push.sh` | publishes the image on GitHub Container Registry for amd64 and arm64 (`--dry-run` to see what it would do) |

The version is the one in the root `package.json`.

## Run the published image

The image is public: `ghcr.io/piconem/sourcebook` on
[GitHub Container Registry](https://github.com/piconem/sourcebook/pkgs/container/sourcebook), for `linux/amd64` and
`linux/arm64`, tagged with each version (`0.2.0`) and `latest`. Pulling it needs no account or login, and running it
needs only `docker-compose.yml` and `.env`, not the repository:

```bash
mkdir sourcebook && cd sourcebook
curl -fsSLO https://raw.githubusercontent.com/piconem/sourcebook/main/docker/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/piconem/sourcebook/main/docker/.env.example
# adjust .env: data folder, port, base path, public URL, version (SOURCEBOOK_VERSION=0.2.0 to pin one)
mkdir -p data                        # before the first start, so it belongs to you and not to root
docker compose up -d                 # pulls the image
docker compose logs sourcebook       # first start: owner username and password
```

Without compose, the same in one command (data in `./data`, this machine only):

```bash
mkdir -p data
docker run -d --name sourcebook --restart unless-stopped -u "$(id -u):$(id -g)" \
  -p 127.0.0.1:4000:4000 -v "$PWD/data:/data" ghcr.io/piconem/sourcebook:latest
docker logs sourcebook
```

### Use a folder you already have

Any folder on your computer can be the workspace: an existing Sourcebook workspace (e.g. `~/Sourcebook`, used so far
with `pnpm start`), or an empty folder where you want your projects to live. Set it in `.env` **before** the first
`docker compose up -d`:

1. **Path** — `SOURCEBOOK_DATA`, preferably absolute:
   ```dotenv
   SOURCEBOOK_DATA=/home/alex/Sourcebook          # Linux
   SOURCEBOOK_DATA=/Users/alex/Sourcebook         # macOS (the folder must be shared with Docker Desktop:
                                                  #   Settings → Resources → File sharing; /Users is by default)
   SOURCEBOOK_DATA=C:/Users/alex/Sourcebook       # Windows (forward slashes; see Windows below)
   ```
2. **Owner of the folder** — the container runs as this user and must be able to write there. On Linux, read them
   from the folder itself:
   ```bash
   stat -c '%u %g' /home/alex/Sourcebook          # e.g. 1000 1000
   ```
   ```dotenv
   SOURCEBOOK_UID=1000
   SOURCEBOOK_GID=1000
   ```
   (On macOS and Windows Docker Desktop maps the permissions itself: leave the defaults.)
3. **Start**: `docker compose up -d`, then `docker compose logs sourcebook`.

What Sourcebook finds there:

| The folder holds | What happens |
|---|---|
| nothing (empty or new folder) | `projects/`, `templates/` and `.sourcebook/` are created, the owner account and the five templates are added |
| a workspace of Sourcebook ≥ 0.2 (it has `.sourcebook/`) | everything stays: projects, templates, **the same accounts, passwords and agent tokens** — sign in as before |
| a workspace of Sourcebook 0.1 (projects, no `.sourcebook/`) | the projects are kept, but the owner account is created as `node` (the user inside the container), so it does not match the name on your old comments. Better: start it **once with Node** (`SOURCEBOOK_WORKSPACE=<folder> pnpm start` in a clone, on the computer where you used 0.1), which makes your old profile the owner; then stop it and switch to Docker |

Good to know:

- Back up the folder before the first start with a new version.
- Do not run the Node server (`pnpm start` / `pnpm dev`) and the container **on the same folder at the same time**:
  each keeps its own sessions and live updates, and they would overwrite each other's changes.
- The files stay plain files in that folder (Markdown, `.mmd`, `.tex`, `.csv`…): you can version it with git or sync
  it as before — but not `.sourcebook/` to a public place: it holds the accounts.
- Without compose: `-v /home/alex/Sourcebook:/data -u "$(stat -c '%u:%g' /home/alex/Sourcebook)"` in the `docker run`
  command above.

## Build it yourself

From a clone of the repository, to try local changes or for an architecture not published:

```bash
docker/build.sh                      # → sourcebook:0.2.0, ghcr.io/piconem/sourcebook:0.2.0 (+ :latest)

cd docker
cp .env.example .env
mkdir -p data
docker compose up -d                 # uses the image just built (same name and tag)
```

## Using it

Open `http://127.0.0.1:4000/`, sign in as the owner and choose a new password. The workspace starts with the
**Sourcebook Demo** template.

- **Data**: everything is in the folder mounted on `/data` (`SOURCEBOOK_DATA`, default `./data` next to
  `docker-compose.yml`): projects, templates and `.sourcebook/` (accounts, password hashes, sessions, tokens,
  settings). Recreating or upgrading the container keeps it; back up that folder. To use a folder you already have:
  [above](#use-a-folder-you-already-have).
- **One port**: the web interface, the REST API (`/api`) and the MCP server for AI assistants (`/mcp`) are served by
  the same server on the same port (`SOURCEBOOK_PORT` on the host): with port 4500 the MCP address is
  `http://127.0.0.1:4500/mcp`. Set `SOURCEBOOK_PUBLIC_URL` to match, since the ready-made MCP command in *Settings → AI
  assistant* is built from it. Behind a proxy the MCP follows the base path too (`https://mydomain.it/marco/sourcebook/mcp`).
- **User**: the container runs as `SOURCEBOOK_UID:SOURCEBOOK_GID` (default 1000:1000), never as root.
- **Upgrade**: `docker compose pull && docker compose up -d` (with `SOURCEBOOK_VERSION=latest`, or after raising the
  pinned version in `.env`); the data folder stays as it is. Release notes: [docs/releases](../docs/releases/).
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

AI assistants (Claude Code, Gemini CLI, OpenAI Codex…) connect to `<SOURCEBOOK_PUBLIC_URL>/mcp` with a personal access
token: *Settings → AI assistant* shows the ready-made commands. Only **HTTP** is offered in the container: with **stdio**
the AI client would start the MCP process itself, on its own machine, and it cannot start it inside the container — so
the image sets `SOURCEBOOK_CONTAINER=1`, Settings shows stdio as unavailable and the server refuses stdio calls.

## Security

What the image does by itself:

- runs as an unprivileged user (uid 1000, or `SOURCEBOOK_UID`), and is reachable only from this machine by default
  (`SOURCEBOOK_BIND=127.0.0.1`);
- every request needs a session (sign-in) or an access token. Passwords are stored as scrypt hashes; session and
  token secrets are stored only as hashes, in `/data/.sourcebook/`. The session cookie is `HttpOnly`,
  `SameSite=Strict`, and `Secure` when `SOURCEBOOK_PUBLIC_URL` is `https://…`. After 5 failed sign-ins for the same
  username and address, sign-in waits (doubling, up to 15 minutes);
- users see only the projects they were given access to, and agents never have more rights than their user;
- uploaded and reference files (SVG, HTML…) opened directly in the browser run in a sandbox (`Content-Security-Policy:
  sandbox`), so a file cannot act with the rights of whoever opens it. Every response carries `nosniff`, frames only
  from Sourcebook itself, and `Referrer-Policy: same-origin`.

What is up to you when it is reachable from other machines:

- **HTTPS**: the container speaks plain HTTP. Put a reverse proxy with a certificate in front of it (see
  [above](#behind-a-reverse-proxy-under-a-path)), with `SOURCEBOOK_PUBLIC_URL=https://…` and
  `SOURCEBOOK_TRUST_PROXY=true` (real client address for the sign-in limit, `Secure` cookie). Do not expose port
  4000 directly (`SOURCEBOOK_BIND=0.0.0.0`) outside a trusted network.
- **First password**: set `SOURCEBOOK_ADMIN_PASSWORD`, otherwise a generated one is printed in the logs (it must be
  changed at the first sign-in either way).
- **Backups and updates**: back up the data folder (it holds the accounts too); pull new versions of the image for
  security fixes.

Known limits: the sign-in limit is kept in memory (it starts over when the container restarts); there is no audit log
beyond the authors of comments and notifications.

## Publish (GHCR)

Not done automatically. When a version is ready (committed, version raised in `package.json`):

```bash
docker/push.sh --dry-run             # checks and shows the commands
export GHCR_TOKEN=<GitHub token with write:packages>   # or: gh auth refresh -s write:packages
docker/push.sh                       # builds amd64 + arm64 and pushes :<version> and :latest
```

It refuses uncommitted changes and versions already published. Building arm64 on an amd64 machine needs QEMU once:
`docker run --privileged --rm tonistiigi/binfmt --install all`. Part of a release: see the
[step-by-step checklist](../docs/releasing.md) (classic token with `write:packages`, login, publishing, visibility).

**Visibility.** A new package on GHCR is **private**. Once, after the first push: GitHub → your profile → *Packages* →
`sourcebook` → *Package settings* → *Change visibility* → **Public**; later versions stay public.
- Anyone can then `docker pull ghcr.io/piconem/sourcebook` (and run the compose file) **without an account or a
  login**; only publishing needs a token. Public packages cost nothing (storage and downloads).
- **It cannot be undone**: a public container package cannot be made private again, only deleted (whole, or
  version by version).
- The label `org.opencontainers.image.source` in the Dockerfile links the package to the repository: GitHub shows it
  under the repository's *Packages*, with the README and the license. The repository and the package have separate
  visibility.
- The image holds no personal data: `.env`, `docker/data`, `.git`, `.claude`, docs and tests stay out of the build
  (`Dockerfile.dockerignore`); workspace, accounts, passwords and tokens live only in the `/data` volume of each
  installation, which starts empty (an owner with its own password and the bundled templates).
