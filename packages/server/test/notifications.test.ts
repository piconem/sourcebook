import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NotebookEvent } from "@sourcebook/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { tempProject } from "./helpers.js";

async function setup() {
  const workspace = await tempProject();
  const { app, workspace: ws } = await buildApp(workspace, { auth: false, configDir: await tempProject() });
  const call = async (method: string, url: string, payload?: object) => {
    const res = await app.inject({ method: method as "GET", url, payload: payload as Record<string, unknown> });
    return { status: res.statusCode, body: res.body ? res.json() : undefined };
  };
  await call("POST", "/api/projects", { name: "Demo" });
  const base = "/api/projects/demo";
  const s1 = (await call("POST", `${base}/blocks`, { title: "Overview" })).body;
  const s11 = (await call("POST", `${base}/blocks`, { title: "Scope", parentId: s1.id })).body;
  const sub = (await call("POST", `${base}/blocks/${s11.id}/subblocks`, { type: "markdown" })).body;
  const comment = (await call("POST", `${base}/blocks/${s11.id}/subblocks/${sub.id}/comments`, { text: "Hm" })).body;
  const { store } = await ws.open("projects", "demo");
  const events: NotebookEvent[] = [];
  store.events.on("event", (e: NotebookEvent) => events.push(e));
  return { call, base, workspace, ids: { s1: s1.id, s11: s11.id, sub: sub.id, comment: comment.id }, events };
}

describe("change notifications", () => {
  it("stores notifications with labelled targets, newest first, and tracks read state", async () => {
    const { call, base, workspace, ids, events } = await setup();
    const author = { name: "Bot", username: "bot", kind: "assistant" as const };
    const n1 = await call("POST", `${base}/notifications`, { author, summary: "Rewrote the overview", targets: [{ blockId: ids.s1 }] });
    expect(n1.status).toBe(201);
    expect(n1.body).toMatchObject({ author, read: false, targets: [{ blockId: ids.s1, label: "§1 Overview" }] });
    const n2 = await call("POST", `${base}/notifications`, {
      summary: "Answered a comment",
      targets: [
        { blockId: ids.s11, subBlockId: ids.sub, note: "new text" },
        { blockId: ids.s11, subBlockId: ids.sub, commentId: ids.comment },
      ],
    });
    expect(n2.body.targets.map((t: { label: string }) => t.label)).toEqual(["§1.1#1 Markdown", "Comment on §1.1#1 Markdown"]);
    expect(n2.body.author.username).toBeTruthy(); // defaults to the user profile
    expect(events.filter((e) => e.type === "notifications")).toHaveLength(2);
    expect(existsSync(join(workspace, "projects", "demo", "notifications.json"))).toBe(true);

    const list = (await call("GET", `${base}/notifications`)).body.notifications;
    expect(list.map((n: { id: string }) => n.id)).toEqual([n2.body.id, n1.body.id]);

    const afterRead = (await call("POST", `${base}/notifications/${n1.body.id}/read`)).body.notifications;
    expect(afterRead.map((n: { read: boolean }) => n.read)).toEqual([false, true]);
    expect((await call("POST", `${base}/notifications/read-all`)).body.notifications.every((n: { read: boolean }) => n.read)).toBe(true);
    expect((await call("POST", `${base}/notifications/nope1234/read`)).status).toBe(404);

    expect((await call("DELETE", `${base}/notifications`)).status).toBe(204);
    expect((await call("GET", `${base}/notifications`)).body.notifications).toEqual([]);
  });

  it("rejects unknown targets", async () => {
    const { call, base, ids } = await setup();
    const bad = async (targets: object[]) => (await call("POST", `${base}/notifications`, { summary: "x", targets })).status;
    expect(await bad([{ blockId: "missing1" }])).toBe(400);
    expect(await bad([{ blockId: ids.s1, subBlockId: ids.sub }])).toBe(400); // sub-block of another section
    expect(await bad([{ blockId: ids.s11, subBlockId: ids.sub, commentId: "missing1" }])).toBe(400);
    expect(await bad([{ blockId: ids.s11, commentId: ids.comment }])).toBe(400);
    expect((await call("POST", `${base}/notifications`, { summary: " ", targets: [] })).status).toBe(400);
  });

  it("asks open editors to reload", async () => {
    const { call, base, ids, events } = await setup();
    const n = (await call("POST", `${base}/notifications`, { summary: "Step 1", targets: [{ blockId: ids.s1 }] })).body;
    const r = await call("POST", `${base}/reload-request`, { message: "Done with the refactoring" });
    expect(r.body).toEqual({ notificationIds: [n.id] });
    expect(events.at(-1)).toMatchObject({ type: "reload", message: "Done with the refactoring", notificationIds: [n.id] });
    expect((await call("POST", `${base}/reload-request`, { notificationIds: ["nope1234"] })).status).toBe(400);

    await call("POST", `${base}/notifications`, { summary: "Step 2", targets: [], requestReload: true });
    expect(events.at(-1)).toMatchObject({ type: "reload" });
    expect(events.at(-1)!.notificationIds).toHaveLength(1);
  });

  it("are not copied with the project", async () => {
    const { call, base, workspace, ids } = await setup();
    await call("POST", `${base}/notifications`, { summary: "x", targets: [{ blockId: ids.s1 }] });
    const copy = (await call("POST", "/api/templates", { name: "Copy", from: { kind: "projects", id: "demo" } })).body;
    expect(existsSync(join(workspace, "templates", copy.id, "notifications.json"))).toBe(false);
  });
});
