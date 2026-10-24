import { strFromU8, unzipSync } from "fflate";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProjectApp } from "./helpers.js";

async function setup() {
  const { app, root } = await buildProjectApp();
  await mkdir(join(root, "references", "papers"), { recursive: true });
  await writeFile(join(root, "references", "papers", "My spec.pdf"), "%PDF");
  await writeFile(join(root, "references", "data.csv"), "a,b\n1,2\n");
  const call = async (method: string, url: string, payload?: object) => {
    const res = await app.inject({ method: method as "GET", url, payload: payload as Record<string, unknown> });
    const type = String(res.headers["content-type"] ?? "");
    return { status: res.statusCode, body: type.includes("json") ? res.json() : res.body, raw: res };
  };
  const b = (await call("POST", "/api/blocks", { title: "Intro" })).body;
  const md = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "markdown", content: { markdown: "Read [the spec](../../../references/papers/My%20spec.pdf) first.\n" } })).body;
  return { app, root, call, b, md };
}

describe("reference files associated with sections and sub-blocks", () => {
  it("associates existing files, rejecting unknown ones, and reports usages", async () => {
    const { call, b, md } = await setup();
    expect((await call("PUT", `/api/blocks/${b.id}/references`, { paths: ["data.csv", "data.csv"] })).body).toEqual({ paths: ["data.csv"] });
    expect((await call("PUT", `/api/blocks/${b.id}/subblocks/${md.id}/references`, { paths: ["papers/My spec.pdf"] })).body).toEqual({ paths: ["papers/My spec.pdf"] });
    const bad = await call("PUT", `/api/blocks/${b.id}/references`, { paths: ["nope.txt"] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Unknown reference file\(s\): nope\.txt/);
    const block = (await call("GET", `/api/blocks/${b.id}`)).body;
    expect(block.references).toEqual(["data.csv"]);
    expect(block.subBlocks[0].references).toEqual(["papers/My spec.pdf"]);

    const usages = (await call("GET", "/api/references/usages?path=papers")).body;
    expect(usages).toEqual([
      { path: "papers/My spec.pdf", kind: "subblock", blockId: b.id, subBlockId: md.id, ref: "§1#1", title: "markdown 1" },
      { path: "papers/My spec.pdf", kind: "text", blockId: b.id, subBlockId: md.id, ref: "§1#1", title: "markdown 1" },
    ]);
    expect((await call("PUT", `/api/blocks/${b.id}/references`, { paths: [] })).body).toEqual({ paths: [] });
    expect((await call("GET", `/api/blocks/${b.id}`)).body.references).toBeUndefined();
  });

  it("moving a file to another folder moves its associations and Markdown links", async () => {
    const { call, b, md } = await setup();
    await call("PUT", `/api/blocks/${b.id}/references`, { paths: ["papers/My spec.pdf"] });
    await call("POST", "/api/references/folders", { path: "archive" });
    expect((await call("POST", "/api/references/move", { paths: ["papers/My spec.pdf"], dir: "archive" })).body).toEqual({
      moved: [{ from: "papers/My spec.pdf", to: "archive/My spec.pdf" }],
    });
    const block = (await call("GET", `/api/blocks/${b.id}`)).body;
    expect(block.references).toEqual(["archive/My spec.pdf"]);
    expect(block.subBlocks.find((s: { id: string }) => s.id === md.id).content.markdown).toContain("(../../../references/archive/My%20spec.pdf)");
  });

  it("renaming a folder moves associations and Markdown links; deleting drops associations", async () => {
    const { call, b, md } = await setup();
    await call("PUT", `/api/blocks/${b.id}/subblocks/${md.id}/references`, { paths: ["papers/My spec.pdf"] });
    await call("PUT", `/api/blocks/${b.id}/references`, { paths: ["data.csv", "papers/My spec.pdf"] });
    expect((await call("PATCH", "/api/references/rename", { path: "papers", newName: "Papers 2026" })).body).toEqual({ path: "Papers 2026" });
    const block = (await call("GET", `/api/blocks/${b.id}`)).body;
    expect(block.references).toEqual(["data.csv", "Papers 2026/My spec.pdf"]);
    expect(block.subBlocks[0].references).toEqual(["Papers 2026/My spec.pdf"]);
    expect(block.subBlocks[0].content.markdown).toContain("[the spec](../../../references/Papers%202026/My%20spec.pdf)");
    expect(block.subBlocks[0].rev).toBe(1);

    await call("POST", "/api/references/delete", { paths: ["Papers 2026"] });
    const after = (await call("GET", `/api/blocks/${b.id}`)).body;
    expect(after.references).toEqual(["data.csv"]);
    expect(after.subBlocks[0].references).toBeUndefined();
    expect(after.subBlocks[0].content.markdown).toContain("Papers%202026/My%20spec.pdf"); // text is left as it is
  });

  it("lists associated files as attachments in the export and includes them in the ZIP", async () => {
    const { app, call, b, md } = await setup();
    await call("PUT", `/api/blocks/${b.id}/references`, { paths: ["data.csv"] });
    await call("PUT", `/api/blocks/${b.id}/subblocks/${md.id}/references`, { paths: ["papers/My spec.pdf"] });
    const markdown = (await call("GET", "/api/project/markdown")).body as string;
    expect(markdown).toContain("## Intro\n\n_Attachments:_ [data.csv](references/data.csv)\n\nRead [the spec]");
    expect(markdown).toContain("first.\n\n_Attachments:_ [My spec.pdf](references/papers/My%20spec.pdf)");
    const zip = unzipSync(new Uint8Array((await app.inject({ method: "GET", url: "/api/project/export.zip" })).rawPayload));
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(["references/data.csv", "references/papers/My spec.pdf"]));
    expect(strFromU8(zip["references/data.csv"])).toBe("a,b\n1,2\n");
  });
});
