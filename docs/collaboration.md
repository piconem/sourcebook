[← Sourcebook](../README.md) · [Installation](installation.md) · [Docker](../docker/README.md) · [User guide](user-guide.md) · [Collaboration](collaboration.md) · [AI assistant](ai-assistant.md) · [REST API](rest-api.md) · [File format](file-format.md) · [Development](development.md) · [Libraries](libraries.md)

# Collaboration: people, access, agents, locks

- **Users**: the owner adds them (Settings → Users) with a temporary password they change at the first sign-in, and
  can disable, reset, delete them or make them owners. Only owners create projects and templates, unless a user is
  given **may create projects** (the creator gets write access to what they create). Only owners delete.
- **Access** (Settings → Project access): per project / template and user, **read** (read and comment) or **write**
  (also edit). Projects without access are invisible. Owners open everything.
- **Agents** (Settings → My agents): each user creates an **access token** (shown once) and configures the MCP server
  with it **once**; all their agents share that configuration. Agents are **identities** registered by the user (or by
  the assistant itself with `register_agent`): every tool takes `agent: "<id>"` to say which one acts, otherwise the
  user's default agent does. An agent has its user's rights and signs as "Reviewer · for Mario Rossi". Only the
  user's own agents can be named; revoking the token, an agent or the user stops them at once. **Revoke** stops an
  agent and keeps its history; **Delete** removes it for good with everything it wrote in every project — threads
  (with their replies), replies, resolutions (threads reopen), notifications, locks, picture — after showing what
  will go and asking to type its id; its id becomes free again. Scripts may use the
  token too (header `x-sourcebook-agent: <id>` to act as an agent, otherwise as the user).
- **Pictures**: each user can set a picture for themselves (Settings → Account) and for each of their agents (My
  agents); the owner can change anyone's. The image is cropped square in the browser (drag and zoom), stored as a
  256×256 WebP and shown in a circle wherever the person or agent appears (comments, notifications, menus); without
  one, the initials.
- **Locks**: a sub-block can be taken (🔒 in its header, or `lock_subblock` for agents): until its holder releases it,
  nobody else can change or delete it (nor delete its section); comments stay open. No expiry: the holder releases it,
  the user an agent works for may release the agent's locks, the owner can release any (in the editor or Settings →
  Locks).
- **Where it is stored**: `<workspace>/.sourcebook/` (folder `0700`, files `0600`, with a `.gitignore` excluding all):
  `accounts.json` (scrypt password hashes), `tokens.json` (SHA-256 of access tokens), `agents.json`, `access.json`,
  `sessions.json` (hashes of session tokens; 30 days, renewed with use), `settings.json` and `avatars/`. Passwords and tokens are never stored. Mount or back
  up the workspace and everything comes along.
- Web sessions are `HttpOnly`, `SameSite=Strict` cookies scoped to the base path; changes must carry the
  `x-sourcebook-client` header (sent by the web client), and repeated wrong passwords are throttled.
