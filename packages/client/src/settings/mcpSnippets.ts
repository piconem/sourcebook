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

export const claudeCodeHttp = (url: string, name = "sourcebook") => `claude mcp add --transport http ${name} ${url}`;

export const jsonHttp = (url: string, name = "sourcebook") => JSON.stringify({ mcpServers: { [name]: { type: "http", url } } }, null, 2);
