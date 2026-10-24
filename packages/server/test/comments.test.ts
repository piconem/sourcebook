import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ls, tempProject, buildProjectApp } from "./helpers.js";

async function setup() {
  const configDir = await tempProject();
  const { app, root, workspace } = await buildProjectApp({ configDir });
  const call = async (method: string, url: string, payload?: object) => {
    const res = await app.inject({ method: method as "GET", url, payload: payload as Record<string, unknown> });
    return { status: res.statusCode, body: res.body ? res.json() : undefined };
  };
  const b = (await call("POST", "/api/blocks", { title: "Intro" })).body;
  const s1 = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "markdown" })).body;
  const s2 = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "equation" })).body;
  const url = (sub: { id: string }) => `/api/blocks/${b.id}/subblocks/${sub.id}/comments`;
  return { root, configDir, workspace, call, b, s1, s2, url };
}

describe("user profile", () => {
  it("is the signed-in account: the name can change, the username cannot; stored in the workspace's .sourcebook", async () => {
    const { root, workspace, configDir, call } = await setup();
    // A new workspace without an older profile: the owner account is "admin".
    expect((await call("GET", "/api/user")).body).toEqual({ name: "Administrator", username: "admin" });

    expect((await call("PUT", "/api/user", { name: "Mario Rossi", username: "mariorossi" })).status).toBe(400);
    expect((await call("PUT", "/api/user", { name: " ", username: "admin" })).status).toBe(400);
    expect((await call("PUT", "/api/user", { name: "Mario Rossi", username: "admin" })).body).toEqual({ name: "Mario Rossi", username: "admin" });
    const accounts = JSON.parse(await readFile(join(workspace, ".sourcebook", "accounts.json"), "utf8"));
    expect(accounts.users[0]).toMatchObject({ username: "admin", name: "Mario Rossi", role: "owner" });
    expect(accounts.users[0].password).toMatch(/^scrypt\$/);
    expect(existsSync(join(root, "user.json"))).toBe(false);

    const { app: again } = await buildProjectApp({ workspace, configDir });
    expect((await again.inject({ method: "GET", url: "/api/user" })).json().name).toBe("Mario Rossi");
  });
});

describe("comments", () => {
  it("adds comments and replies in time order, authored by the current profile by default", async () => {
    const { root, call, b, s1, url } = await setup();
    await call("PUT", "/api/user", { name: "Mario Rossi", username: "admin" });

    const c1 = (await call("POST", url(s1), { text: "  Is this still valid?  " })).body;
    expect(c1).toMatchObject({ text: "Is this still valid?", author: { name: "Mario Rossi", username: "admin" }, replies: [] });
    expect(Date.parse(c1.createdAt)).not.toBeNaN();

    const c2 = (await call("POST", url(s1), { text: "Second", author: { name: "Anna Bianchi", username: "annab" } })).body;
    const r1 = (await call("POST", `${url(s1)}/${c1.id}/replies`, { text: "Yes" })).body;
    const r2 = (await call("POST", `${url(s1)}/${c1.id}/replies`, { text: "Checked again" })).body;

    const list = (await call("GET", url(s1))).body.comments;
    expect(list.map((c: { text: string }) => c.text)).toEqual(["Is this still valid?", "Second"]);
    expect(list[1].author.username).toBe("annab");
    expect(list[0].replies.map((r: { id: string }) => r.id)).toEqual([r1.id, r2.id]);
    expect(c1.createdAt < c2.createdAt && r1.createdAt < r2.createdAt).toBe(true);

    // Stored in a file of its own next to the sub-block source
    expect(await ls(join(root, "blocks/001-intro/subblocks"))).toContain("01-markdown.comments.json");
    const onDisk = JSON.parse(await readFile(join(root, "blocks/001-intro/subblocks/01-markdown.comments.json"), "utf8"));
    expect(onDisk.version).toBe(1);
    expect(onDisk.comments).toHaveLength(2);

    // Counts are exposed with the block
    const block = (await call("GET", `/api/blocks/${b.id}`)).body;
    expect(block.subBlocks.map((s: { commentCount: number }) => s.commentCount)).toEqual([2, 0]);
  });

  it("validates input and reports missing targets", async () => {
    const { b, s1, call, url } = await setup();
    expect((await call("POST", url(s1), { text: "   " })).status).toBe(400);
    expect((await call("POST", url(s1), { text: "x", author: { name: "X", username: "Bad Name" } })).status).toBe(400);
    expect((await call("POST", `/api/blocks/${b.id}/subblocks/nope/comments`, { text: "x" })).status).toBe(404);
    expect((await call("POST", `${url(s1)}/nope/replies`, { text: "x" })).status).toBe(404);
    expect((await call("DELETE", `${url(s1)}/nope`)).status).toBe(404);
  });

  it("deletes replies and comments; the file goes away with the last comment", async () => {
    const { root, call, s1, url } = await setup();
    const c = (await call("POST", url(s1), { text: "A" })).body;
    const r = (await call("POST", `${url(s1)}/${c.id}/replies`, { text: "B" })).body;
    expect((await call("DELETE", `${url(s1)}/${c.id}/replies/${r.id}`)).status).toBe(204);
    expect((await call("GET", url(s1))).body.comments[0].replies).toEqual([]);
    expect((await call("DELETE", `${url(s1)}/${c.id}`)).status).toBe(204);
    expect((await call("GET", url(s1))).body.comments).toEqual([]);
    expect(existsSync(join(root, "blocks/001-intro/subblocks/01-markdown.comments.json"))).toBe(false);
  });

  it("the comments file follows sub-block renumbering and deletion", async () => {
    const { root, call, b, s1, s2, url } = await setup();
    await call("POST", url(s1), { text: "on markdown" });
    await call("POST", url(s2), { text: "on equation" });
    await call("PATCH", `/api/blocks/${b.id}/subblocks/reorder`, { order: [s2.id, s1.id] });
    const dir = join(root, "blocks/001-intro/subblocks");
    expect(await ls(dir)).toEqual(["01-equation.comments.json", "01-equation.tex", "02-markdown.comments.json", "02-markdown.md"]);
    expect((await call("GET", url(s1))).body.comments[0].text).toBe("on markdown");

    await call("DELETE", `/api/blocks/${b.id}/subblocks/${s2.id}`);
    expect(await ls(dir)).toEqual(["01-markdown.comments.json", "01-markdown.md"]);
    expect((await call("GET", url(s1))).body.comments[0].text).toBe("on markdown");
  });
});

describe("anchored comments", () => {
  it("stores anchors on text-based types, re-attaches and detaches them", async () => {
    const { call, b, s1, s2, url } = await setup(); // s1 markdown ("text"), s2 equation (no anchors)
    const anchor = { unit: "text", exact: "returns JSON", prefix: "The API ", suffix: ".", start: 8 };
    const c = (await call("POST", url(s1), { text: "Which schema?", anchor })).body;
    expect(c.anchor).toEqual(anchor);
    expect((await call("GET", url(s1))).body.comments[0].anchor).toEqual(anchor);

    const moved = { ...anchor, exact: "returns YAML", start: 20 };
    expect((await call("PATCH", `${url(s1)}/${c.id}`, { anchor: moved })).body.anchor).toEqual(moved);
    const detached = (await call("PATCH", `${url(s1)}/${c.id}`, { anchor: null })).body;
    expect(detached.anchor).toBeUndefined();
    expect((await call("GET", url(s1))).body.comments[0]).not.toHaveProperty("anchor");

    // Defaults for context fields
    const minimal = (await call("POST", url(s1), { text: "x", anchor: { unit: "text", exact: "API" } })).body;
    expect(minimal.anchor).toEqual({ unit: "text", exact: "API", prefix: "", suffix: "" });

    // Wrong unit / unsupported type / invalid anchor
    expect((await call("POST", url(s1), { text: "x", anchor: { ...anchor, unit: "lines" } })).status).toBe(400);
    expect((await call("POST", url(s2), { text: "x", anchor })).status).toBe(400);
    expect((await call("POST", url(s1), { text: "x", anchor: { unit: "text", exact: "" } })).status).toBe(400);
    expect((await call("PATCH", `${url(s1)}/nope`, { anchor: null })).status).toBe(404);

    const code = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "code", content: { language: "python", code: "x = 1\n" } })).body;
    const lineAnchor = { unit: "lines", exact: "x = 1", prefix: "", suffix: "\n", start: 0 };
    expect((await call("POST", url(code), { text: "rename x", anchor: lineAnchor })).body.anchor).toEqual(lineAnchor);
  });
});

describe("anchoring by source lines (API convenience)", () => {
  it("code: turns lines into a quote, reports current lines, detaches when the lines go", async () => {
    const { call, b, url } = await setup();
    const code = "import os\n\ndef main():\n    print('hi')\n    return 0\n";
    const s = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "code", content: { language: "python", code } })).body;

    const c = (await call("POST", url(s), { text: "Use logging", anchor: { lines: { first: 4, last: 5 } } })).body;
    expect(c.anchor).toMatchObject({ unit: "lines", exact: "    print('hi')\n    return 0", prefix: "import os\n\ndef main():\n" });
    expect(c.resolved).toEqual({ lines: { first: 4, last: 5 } });

    // The code changes: the comment is reported where its lines are now.
    await call("PATCH", `/api/blocks/${b.id}/subblocks/${s.id}`, { content: { language: "python", code: "import sys\n" + code } });
    expect((await call("GET", url(s))).body.comments[0].resolved).toEqual({ lines: { first: 5, last: 6 } });

    await call("PATCH", `/api/blocks/${b.id}/subblocks/${s.id}`, { content: { language: "python", code: "import os\n" } });
    const detached = (await call("GET", url(s))).body.comments[0];
    expect(detached.resolved).toBeNull();
    expect(detached.anchor.exact).toBe("    print('hi')\n    return 0"); // original quote kept

    // Re-attach by lines
    const re = (await call("PATCH", `${url(s)}/${c.id}`, { anchor: { lines: { first: 1, last: 1 } } })).body;
    expect(re.anchor.exact).toBe("import os");
    expect(re.resolved).toEqual({ lines: { first: 1, last: 1 } });
  });

  it("markdown: quotes the visible text of the source lines, without syntax", async () => {
    const { call, b, url } = await setup();
    const md = "# Title\n\nThe API is **REST** and `fast`.\n\n- item one\n- item two\n\n```ts\nconst x = 1;\n```\n";
    const s = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "markdown", content: { markdown: md } })).body;

    const para = (await call("POST", url(s), { text: "p", anchor: { lines: { first: 3, last: 3 } } })).body;
    expect(para.anchor).toMatchObject({ unit: "text", exact: "The API is REST and fast." });
    expect(para.resolved).toEqual({ lines: { first: 3, last: 3 } });

    const list = (await call("POST", url(s), { text: "l", anchor: { lines: { first: 5, last: 6 } } })).body;
    expect(list.anchor.exact).toBe("item one\nitem two");
    expect(list.resolved).toEqual({ lines: { first: 5, last: 6 } });

    const codeLine = (await call("POST", url(s), { text: "c", anchor: { lines: { first: 9, last: 9 } } })).body;
    expect(codeLine.anchor.exact).toBe("const x = 1;");
    expect(codeLine.resolved).toEqual({ lines: { first: 9, last: 9 } });

    // A quote made in the editor (visible text) is reported with its source lines too.
    const quoted = (await call("POST", url(s), { text: "q", anchor: { unit: "text", exact: "item two" } })).body;
    expect(quoted.resolved).toEqual({ lines: { first: 6, last: 6 } });
  });

  it("rejects bad line selectors", async () => {
    const { call, b, s2, url } = await setup(); // s2 = equation
    const s = (await call("POST", `/api/blocks/${b.id}/subblocks`, { type: "code", content: { language: "python", code: "a\n\nb\n" } })).body;
    expect((await call("POST", url(s), { text: "x", anchor: { lines: { first: 2, last: 2 } } })).status).toBe(400); // blank
    expect((await call("POST", url(s), { text: "x", anchor: { lines: { first: 3, last: 9 } } })).status).toBe(400); // outside
    expect((await call("POST", url(s), { text: "x", anchor: { lines: { first: 3, last: 1 } } })).status).toBe(400); // reversed
    expect((await call("POST", url(s), { text: "x", anchor: { lines: { first: 0, last: 1 } } })).status).toBe(400);
    expect((await call("POST", url(s2), { text: "x", anchor: { lines: { first: 1, last: 1 } } })).status).toBe(400);
  });
});

describe("resolving comments", () => {
  it("resolves and reopens threads, counts only open ones and lists the project's threads", async () => {
    const { call, b, s1, s2, url } = await setup();
    const c1 = (await call("POST", url(s1), { text: "Fix this" })).body;
    const c2 = (await call("POST", url(s2), { text: "Check the sign" })).body;

    const resolved = await call("POST", `${url(s1)}/${c1.id}/resolve`);
    expect(resolved.status).toBe(200);
    expect(resolved.body.resolution.by.username).toBeTruthy();
    const block = (await call("GET", `/api/blocks/${b.id}`)).body;
    expect(block.subBlocks.map((s: { commentCount: number }) => s.commentCount)).toEqual([0, 1]);

    const all = (await call("GET", "/api/comments")).body.threads;
    expect(all.map((t: { comment: { id: string }; subBlockIndex: number }) => [t.comment.id, t.subBlockIndex])).toEqual([
      [c1.id, 1],
      [c2.id, 2],
    ]);
    expect(all[0]).toMatchObject({ blockId: b.id, sectionTitle: "Intro", subBlockId: s1.id, subBlockType: "markdown" });
    expect((await call("GET", "/api/comments?status=open")).body.threads.map((t: { comment: { id: string } }) => t.comment.id)).toEqual([c2.id]);
    expect((await call("GET", "/api/comments?status=resolved")).body.threads.map((t: { comment: { id: string } }) => t.comment.id)).toEqual([c1.id]);

    const reopened = (await call("POST", `${url(s1)}/${c1.id}/reopen`)).body;
    expect(reopened.resolution).toBeUndefined();
    expect((await call("GET", "/api/comments?status=open")).body.threads).toHaveLength(2);
    expect((await call("POST", `${url(s1)}/nope123/resolve`)).status).toBe(404);
  });
});
