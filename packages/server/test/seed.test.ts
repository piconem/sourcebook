import { existsSync } from "node:fs";
import { join } from "node:path";
import { coreTypes } from "@sourcebook/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { tempProject } from "./helpers.js";

async function start(workspace: string, configDir: string) {
  const { app, seededTemplates } = await buildApp(workspace, { auth: false, configDir, seedTemplates: true });
  const get = async (url: string) => {
    const res = await app.inject({ method: "GET", url });
    return res.headers["content-type"]?.toString().includes("json") ? res.json() : res.body;
  };
  return { app, seededTemplates, get };
}

describe("bundled templates", () => {
  it("adds Sourcebook Demo once, with a sub-block of every type", async () => {
    const workspace = await tempProject();
    const configDir = await tempProject();
    const { app, seededTemplates, get } = await start(workspace, configDir);
    expect(seededTemplates).toEqual(["sourcebook-demo"]);
    expect((await get("/api/templates")).map((t: { id: string }) => t.id)).toEqual(["sourcebook-demo"]);
    expect(existsSync(join(workspace, "templates", ".seed-sourcebook-demo"))).toBe(false);

    const base = "/api/templates/sourcebook-demo";
    const notebook = await get(`${base}/notebook`);
    expect(notebook.name).toBe("Sourcebook Demo");
    const types = new Set<string>();
    for (const b of notebook.blocks) {
      const block = await get(`${base}/blocks/${b.id}`);
      for (const s of block.subBlocks) {
        types.add(s.type);
        if (s.type === "image") expect(await app.inject({ method: "GET", url: `${base}/blocks/${b.id}/files/${s.content.src}` }).then((r) => r.statusCode)).toBe(200);
      }
    }
    expect([...types].sort()).toEqual(coreTypes.map((t) => t.type).sort());
    expect(notebook.blocks.some((b: { parentId: string | null }) => b.parentId)).toBe(true); // nested sections

    expect((await get(`${base}/bibliography`)).map((e: { key: string }) => e.key)).toEqual(["knuth1984literate"]);
    const markdown = await get(`${base}/markdown`);
    expect(markdown).toContain("Knuth 1984");
    expect(markdown).toMatch(/\| experiment +\| model +\|/);

    // A project made from it starts with the same content.
    const p = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Try it", from: { kind: "templates", id: "sourcebook-demo" } } });
    expect(p.json().sections).toBe(notebook.blocks.length);
    await app.close();

    // Deleted by the owner: not added again at the next start.
    const again = await start(workspace, configDir);
    await again.app.inject({ method: "DELETE", url: base });
    await again.app.close();
    const third = await start(workspace, configDir);
    expect(third.seededTemplates).toEqual([]);
    expect(await third.get("/api/templates")).toEqual([]);
  });

  it("is off unless asked for (tests and embedding)", async () => {
    const { app } = await buildApp(await tempProject(), { auth: false, configDir: await tempProject() });
    expect((await app.inject({ method: "GET", url: "/api/templates" })).json()).toEqual([]);
  });
});
