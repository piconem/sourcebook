import type { McpSettingsView } from "@sourcebook/shared";

type Stdio = McpSettingsView["connection"]["stdio"];

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
  return { http: { ...c.http, headers: map(c.http.headers) }, stdio: { ...c.stdio, env: map(c.stdio.env) } };
}
