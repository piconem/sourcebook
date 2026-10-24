import type { McpSettingsView } from "@sourcebook/shared";

type Stdio = NonNullable<McpSettingsView["connection"]["stdio"]>;

/** POSIX shell quoting: plain words stay as they are, anything else goes in single quotes. */
export function shellQuote(arg: string): string {
  if (/^[\w@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export const claudeCodeStdio = (s: Stdio, name = "sourcebook") =>
  [
    "claude mcp add",
    ...Object.entries(s.env).map(([k, v]) => `-e ${shellQuote(`${k}=${v}`)}`),
    name,
    "--",
    s.command,
    ...s.args.map(shellQuote),
  ].join(" ");

export const desktopJsonStdio = (s: Stdio, name = "sourcebook") =>
  JSON.stringify({ mcpServers: { [name]: { command: s.command, args: s.args, ...(Object.keys(s.env).length ? { env: s.env } : {}) } } }, null, 2);

type Http = McpSettingsView["connection"]["http"];

export const claudeCodeHttp = (h: Http, name = "sourcebook") =>
  [`claude mcp add --transport http ${name} ${shellQuote(h.url)}`, ...Object.entries(h.headers ?? {}).map(([k, v]) => `--header ${shellQuote(`${k}: ${v}`)}`)].join(" ");

export const jsonHttp = (h: Http, name = "sourcebook") =>
  JSON.stringify({ mcpServers: { [name]: { type: "http", url: h.url, ...(h.headers && Object.keys(h.headers).length ? { headers: h.headers } : {}) } } }, null, 2);

/** Gemini CLI (`~/.gemini/settings.json`, user scope); its settings file also accepts the JSON of `jsonHttp`. */
export const geminiHttp = (h: Http, name = "sourcebook") =>
  [
    "gemini mcp add --scope user --transport http",
    ...Object.entries(h.headers ?? {}).map(([k, v]) => `--header ${shellQuote(`${k}: ${v}`)}`),
    name,
    shellQuote(h.url),
  ].join(" ");

/** Environment variable OpenAI Codex reads the bearer token from (it takes no inline header). */
export const CODEX_TOKEN_VAR = "SOURCEBOOK_TOKEN";

/** OpenAI Codex CLI: the token comes from SOURCEBOOK_TOKEN in the environment Codex starts in. */
export const codexHttp = (h: Http, name = "sourcebook") => `codex mcp add ${name} --url ${shellQuote(h.url)} --bearer-token-env-var ${CODEX_TOKEN_VAR}`;

/** The same, as `~/.codex/config.toml`. */
export const codexToml = (h: Http, name = "sourcebook") =>
  [`[mcp_servers.${name}]`, `url = ${JSON.stringify(h.url)}`, `bearer_token_env_var = ${JSON.stringify(CODEX_TOKEN_VAR)}`].join("\n");

/** Placeholder of the server's connection hints, replaced by the user's access token. */
export const TOKEN_PLACEHOLDER = "<your access token>";

/**
 * Claude Code project configuration (.mcp.json) reading the token from the environment: commit it once, start each
 * session with its own SOURCEBOOK_TOKEN.
 */
export const mcpJsonWithEnvToken = (h: Http, name = "sourcebook") =>
  JSON.stringify({ mcpServers: { [name]: { type: "http", url: h.url, headers: { Authorization: "Bearer ${SOURCEBOOK_TOKEN}" } } } }, null, 2);

/** Connection parameters with the user's real token in place of the placeholder. */
export function withToken(c: McpSettingsView["connection"], token: string): McpSettingsView["connection"] {
  const fill = (v: string) => v.replace(TOKEN_PLACEHOLDER, token);
  const map = (o: Record<string, string> = {}) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fill(v)]));
  return { http: { ...c.http, headers: map(c.http.headers) }, stdio: c.stdio && { ...c.stdio, env: map(c.stdio.env) } };
}
