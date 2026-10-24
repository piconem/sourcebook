import { describe, expect, it } from "vitest";
import { mcpJsonWithEnvToken, withToken, claudeCodeHttp, claudeCodeStdio, desktopJsonStdio, jsonHttp, shellQuote } from "./mcpSnippets";

const stdio = {
  command: "pnpm",
  args: ["--silent", "--dir", "/home/me/University&Research/sourcebook", "--filter", "@sourcebook/mcp", "exec", "tsx", "src/stdio.ts"],
  cwd: "/home/me/University&Research/sourcebook",
  env: {},
};

describe("MCP connection snippets", () => {
  it("quotes shell arguments that need it", () => {
    expect(shellQuote("--silent")).toBe("--silent");
    expect(shellQuote("@sourcebook/mcp")).toBe("@sourcebook/mcp");
    expect(shellQuote("/a/University&Research")).toBe("'/a/University&Research'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it("builds the Claude Code commands", () => {
    expect(claudeCodeStdio(stdio)).toBe(
      "claude mcp add sourcebook -- pnpm --silent --dir '/home/me/University&Research/sourcebook' --filter @sourcebook/mcp exec tsx src/stdio.ts",
    );
    expect(claudeCodeStdio({ ...stdio, env: { SOURCEBOOK_URL: "http://127.0.0.1:4555" } })).toMatch(/^claude mcp add -e SOURCEBOOK_URL=http:\/\/127\.0\.0\.1:4555 sourcebook -- pnpm/);
    expect(claudeCodeHttp({ url: "http://127.0.0.1:4000/mcp" })).toBe("claude mcp add --transport http sourcebook http://127.0.0.1:4000/mcp");
    expect(claudeCodeHttp({ url: "http://127.0.0.1:4000/mcp", headers: { Authorization: "Bearer sbk_x" } }, "sb-writer")).toBe(
      "claude mcp add --transport http sb-writer http://127.0.0.1:4000/mcp --header 'Authorization: Bearer sbk_x'",
    );
  });

  it("builds client JSON configurations", () => {
    expect(JSON.parse(desktopJsonStdio(stdio))).toEqual({ mcpServers: { sourcebook: { command: "pnpm", args: stdio.args } } });
    expect(JSON.parse(desktopJsonStdio({ ...stdio, env: { SOURCEBOOK_URL: "u" } })).mcpServers.sourcebook.env).toEqual({ SOURCEBOOK_URL: "u" });
    expect(JSON.parse(jsonHttp({ url: "http://x/mcp" }))).toEqual({ mcpServers: { sourcebook: { type: "http", url: "http://x/mcp" } } });
    expect(JSON.parse(jsonHttp({ url: "http://x/mcp", headers: { Authorization: "Bearer t" } })).mcpServers.sourcebook.headers).toEqual({ Authorization: "Bearer t" });
  });

  it("builds a project .mcp.json that reads the token from the environment", () => {
    expect(JSON.parse(mcpJsonWithEnvToken({ url: "http://x/mcp" })).mcpServers.sourcebook).toEqual({
      type: "http",
      url: "http://x/mcp",
      headers: { Authorization: "Bearer ${SOURCEBOOK_TOKEN}" },
    });
  });

  it("fills in the user's token", () => {
    const c = withToken({ http: { url: "u", headers: { Authorization: "Bearer <your access token>" } }, stdio: { ...stdio, env: { SOURCEBOOK_TOKEN: "<your access token>" } } }, "sbk_1");
    expect(c.http.headers).toEqual({ Authorization: "Bearer sbk_1" });
    expect(c.stdio.env).toEqual({ SOURCEBOOK_TOKEN: "sbk_1" });
  });
});
