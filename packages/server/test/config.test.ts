import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadConfig, normalizeBasePath } from "../src/config.js";

describe("startup configuration", () => {
  it("normalizes the base path", () => {
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath("marco//sourcebook/")).toBe("/marco/sourcebook");
    expect(() => normalizeBasePath("/a b")).toThrow();
  });

  it("offers MCP over stdio except in a container, unless SOURCEBOOK_MCP_STDIO says otherwise", () => {
    if (!existsSync("/.dockerenv")) expect(loadConfig([], {}).mcpStdio).toBe(true);
    expect(loadConfig([], { SOURCEBOOK_CONTAINER: "1" }).mcpStdio).toBe(false);
    expect(loadConfig([], { SOURCEBOOK_CONTAINER: "1", SOURCEBOOK_MCP_STDIO: "true" }).mcpStdio).toBe(true);
    expect(loadConfig([], { SOURCEBOOK_MCP_STDIO: "false" }).mcpStdio).toBe(false);
  });
});
