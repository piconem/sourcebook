import { describe, expect, it } from "vitest";
import { claudeCodeHttp, claudeCodeStdio, desktopJsonStdio, jsonHttp, shellQuote } from "./mcpSnippets";

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
    expect(claudeCodeHttp("http://127.0.0.1:4000/mcp")).toBe("claude mcp add --transport http sourcebook http://127.0.0.1:4000/mcp");
  });

  it("builds client JSON configurations", () => {
    expect(JSON.parse(desktopJsonStdio(stdio))).toEqual({ mcpServers: { sourcebook: { command: "pnpm", args: stdio.args } } });
    expect(JSON.parse(desktopJsonStdio({ ...stdio, env: { SOURCEBOOK_URL: "u" } })).mcpServers.sourcebook.env).toEqual({ SOURCEBOOK_URL: "u" });
    expect(JSON.parse(jsonHttp("http://x/mcp"))).toEqual({ mcpServers: { sourcebook: { type: "http", url: "http://x/mcp" } } });
  });
});
