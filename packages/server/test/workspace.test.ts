import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ls, tempProject } from "./helpers.js";

async function setup() {
  const workspace = await tempProject();
  const configDir = await tempProject();
  const { app } = await buildApp(workspace, { configDir });
  const call = async (method: string, url: string, payload?: object) => {
    const res = await app.inject({ method: method as "GET", url, payload: payload as Record<string, unknown> });
    return { status: res.statusCode, body: res.headers["content-type"]?.toString().includes("json") ? res.json() : res.body };
  };
  return { workspace, configDir, app, call };
}

describe("projects", () => {
  it("creates, lists, renames and deletes projects (folders under projects/)", async () => {
    const { workspace, call } = await setup();
    expect((await call("GET", "/api/projects")).body).toEqual([]);

    const p = (await call("POST", "/api/projects", { name: "Payment Service", description: "Design notes" })).body;
    expect(p).toMatchObject({ id: "payment-service", kind: "projects", name: "Payment Service", description: "Design notes", sections: 0 });
    expect(await ls(join(workspace, "projects", "payment-service"))).toEqual(["blocks", "notebook.json", "project.json"]);
    // Same name again: a distinct folder
    expect((await call("POST", "/api/projects", { name: "Payment service" })).body.id).toBe("payment-service-2");

    await call("POST", "/api/projects/payment-service/blocks", { title: "Intro" });
    const list = (await call("GET", "/api/projects")).body;
    expect(list.map((x: { id: string }) => x.id)).toEqual(["payment-service", "payment-service-2"]); // most recently changed first
    expect(list[0].sections).toBe(1);

    const renamed = (await call("PATCH", "/api/projects/payment-service", { name: "Payments v2" })).body;
    expect(renamed).toMatchObject({ id: "payment-service", name: "Payments v2" }); // id (folder) is stable
    expect((await call("GET", "/api/projects/payment-service/notebook")).body.name).toBe("Payments v2");

    expect((await call("DELETE", "/api/projects/payment-service-2")).status).toBe(204);
    expect(existsSync(join(workspace, "projects", "payment-service-2"))).toBe(false);
    expect((await call("GET", "/api/projects/payment-service-2")).status).toBe(404);
    expect((await call("GET", "/api/projects/payment-service-2/notebook")).status).toBe(404);
  });

  it("validates input and ids", async () => {
    const { call } = await setup();
    expect((await call("POST", "/api/projects", { name: "  " })).status).toBe(400);
    expect((await call("GET", "/api/projects/..%2F..%2Fetc")).status).toBe(400);
    expect((await call("GET", "/api/projects/Bad_Id/notebook")).status).toBe(400);
    expect((await call("PATCH", "/api/projects/nope", { name: "x" })).status).toBe(404);
    expect((await call("POST", "/api/projects", { name: "x", from: { kind: "templates", id: "nope" } })).status).toBe(404);
  });

  it("lists folders copied in by hand, deriving their metadata", async () => {
    const { workspace, call } = await setup();
    const dir = join(workspace, "projects", "legacy-notes");
    await mkdir(join(dir, "blocks"), { recursive: true });
    await writeFile(join(dir, "notebook.json"), JSON.stringify({ version: 1, blocks: [] }));
    await mkdir(join(workspace, "projects", "Not A Project"), { recursive: true });
    const list = (await call("GET", "/api/projects")).body;
    expect(list.map((x: { id: string; name: string }) => [x.id, x.name])).toEqual([["legacy-notes", "legacy-notes"]]);
  });

  it("keeps projects isolated from each other", async () => {
    const { call } = await setup();
    await call("POST", "/api/projects", { name: "A" });
    await call("POST", "/api/projects", { name: "B" });
    await call("POST", "/api/projects/a/blocks", { title: "Only in A" });
    expect((await call("GET", "/api/projects/a/notebook")).body.blocks).toHaveLength(1);
    expect((await call("GET", "/api/projects/b/notebook")).body.blocks).toHaveLength(0);
  });
});

describe("templates", () => {
  it("are edited through the same API and cloned into projects without comments", async () => {
    const { workspace, call } = await setup();
    const t = (await call("POST", "/api/templates", { name: "Design Doc", description: "Standard structure" })).body;
    expect(t).toMatchObject({ id: "design-doc", kind: "templates" });

    const goals = (await call("POST", "/api/templates/design-doc/blocks", { title: "Goals" })).body;
    await call("PATCH", `/api/templates/design-doc/blocks/${goals.id}`, { objective: "Why we build this" });
    const md = (await call("POST", `/api/templates/design-doc/blocks/${goals.id}/subblocks`, { type: "markdown", content: { markdown: "- Goal 1\n" } })).body;
    await call("POST", `/api/templates/design-doc/blocks/${goals.id}/subblocks/${md.id}/comments`, { text: "template-only note" });
    await call("POST", "/api/templates/design-doc/references/folders", { path: "standards" });

    const p = (await call("POST", "/api/projects", { name: "Checkout", from: { kind: "templates", id: "design-doc" } })).body;
    expect(p).toMatchObject({ id: "checkout", name: "Checkout", sections: 1, createdFrom: { kind: "templates", id: "design-doc", name: "Design Doc" } });

    const project = (await call("GET", "/api/projects/checkout/notebook")).body;
    expect(project.name).toBe("Checkout");
    const block = (await call("GET", `/api/projects/checkout/blocks/${goals.id}`)).body;
    expect(block).toMatchObject({ title: "Goals", objective: "Why we build this" });
    expect(block.subBlocks[0]).toMatchObject({ content: { markdown: "- Goal 1\n" }, commentCount: 0 });
    expect(existsSync(join(workspace, "projects", "checkout", "references", "standards"))).toBe(true);
    expect(JSON.parse(await readFile(join(workspace, "projects", "checkout", "project.json"), "utf8")).name).toBe("Checkout");

    // The template keeps its comments and is unaffected by edits to the project.
    await call("PATCH", `/api/projects/checkout/blocks/${goals.id}`, { title: "Checkout goals" });
    expect((await call("GET", `/api/templates/design-doc/blocks/${goals.id}`)).body.title).toBe("Goals");
    expect((await call("GET", `/api/templates/design-doc/blocks/${goals.id}/subblocks/${md.id}/comments`)).body.comments).toHaveLength(1);
  });

  it("a project can be saved as a template", async () => {
    const { call } = await setup();
    await call("POST", "/api/projects", { name: "API spec" });
    await call("POST", "/api/projects/api-spec/blocks", { title: "Endpoints" });
    const t = (await call("POST", "/api/templates", { name: "API spec template", from: { kind: "projects", id: "api-spec" } })).body;
    expect(t).toMatchObject({ kind: "templates", id: "api-spec-template", sections: 1, createdFrom: { kind: "projects", id: "api-spec" } });
    expect((await call("GET", "/api/templates")).body).toHaveLength(1);
    expect((await call("GET", "/api/projects")).body).toHaveLength(1);
  });
});
