import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSourcebookMcpServer, injectApi, type Injectable } from "@sourcebook/mcp";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp, type AppOptions } from "../src/app.js";
import { tempProject } from "./helpers.js";

type App = Awaited<ReturnType<typeof buildApp>>["app"];
const WEB = { "x-sourcebook-client": "web-test" };

/** A signed-in browser: keeps the session cookie, sends the client header. */
function browser(app: App, prefix = "") {
  let cookie = "";
  const call = async (method: string, url: string, payload?: object, headers: Record<string, string> = WEB) => {
    const res = await app.inject({ method: method as "GET", url: prefix + url, payload: payload as Record<string, unknown>, headers: { ...headers, ...(cookie ? { cookie } : {}) } });
    const set = res.headers["set-cookie"];
    if (set) cookie = String([set].flat()[0]).split(";")[0];
    return { status: res.statusCode, body: res.body ? res.json() : undefined, headers: res.headers };
  };
  return {
    call,
    login: (username: string, password: string) => call("POST", "/api/auth/login", { username, password }),
    get cookie() {
      return cookie;
    },
  };
}

async function setup(opts: AppOptions = {}) {
  const workspace = await tempProject();
  const built = await buildApp(workspace, { configDir: await tempProject(), adminPassword: "admin-pass-1", ...opts });
  const owner = browser(built.app, opts.basePath);
  await owner.login("admin", "admin-pass-1");
  await owner.call("POST", "/api/auth/password", { currentPassword: "admin-pass-1", newPassword: "owner-pass-2" });
  return { ...built, workspace, owner };
}

/** Owner creates a user (temporary password), the user signs in and sets their own. */
async function addUser(app: App, owner: ReturnType<typeof browser>, username: string, extra: object = {}) {
  expect((await owner.call("POST", "/api/users", { username, name: username.toUpperCase(), password: "temporary-1", ...extra })).status).toBe(201);
  const b = browser(app);
  await b.login(username, "temporary-1");
  await b.call("POST", "/api/auth/password", { currentPassword: "temporary-1", newPassword: `${username}-pass-9` });
  return b;
}

describe("sign-in", () => {
  it("creates the owner on the first start, stores only hashes and forces a password change", async () => {
    const workspace = await tempProject();
    const { app, initialAdminPassword } = await buildApp(workspace, { configDir: await tempProject() });
    expect(initialAdminPassword).toMatch(/^[\w-]{16}$/);
    const dir = join(workspace, ".sourcebook");
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const raw = await readFile(join(dir, "accounts.json"), "utf8");
    expect(raw).not.toContain(initialAdminPassword!);
    expect(JSON.parse(raw).users[0]).toMatchObject({ username: "admin", role: "owner", mustChangePassword: true });
    expect(statSync(join(dir, "accounts.json")).mode & 0o777).toBe(0o600);
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toContain("*");

    const b = browser(app);
    expect((await b.call("GET", "/api/projects")).status).toBe(401);
    expect((await b.login("admin", "wrong")).status).toBe(401);
    const me = await b.login("admin", initialAdminPassword!);
    expect(me.body.user).toMatchObject({ username: "admin", mustChangePassword: true });
    expect(String(me.headers["set-cookie"])).toMatch(/HttpOnly; SameSite=Strict/);
    // Until the password is changed, only the account endpoints work.
    expect((await b.call("GET", "/api/projects")).body).toMatchObject({ details: { code: "password_change_required" } });
    expect((await b.call("POST", "/api/auth/password", { currentPassword: "nope", newPassword: "a-new-password" })).status).toBe(403);
    expect((await b.call("POST", "/api/auth/password", { currentPassword: initialAdminPassword, newPassword: "a-new-password" })).body.user.mustChangePassword).toBe(false);
    expect((await b.call("GET", "/api/projects")).status).toBe(200);

    // Sessions survive a restart; logout ends them.
    const { app: again } = await buildApp(workspace, { configDir: await tempProject() });
    const res = await again.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: b.cookie } });
    expect(res.json().user.username).toBe("admin");
    await b.call("POST", "/api/auth/logout");
    expect((await b.call("GET", "/api/auth/me")).status).toBe(401);
  });

  it("imports the profile of an older version as the owner, and uses SOURCEBOOK_ADMIN_PASSWORD", async () => {
    const workspace = await tempProject();
    const configDir = await tempProject();
    await writeFile(join(configDir, "user.json"), JSON.stringify({ name: "Mario Rossi", username: "mariorossi" }));
    await writeFile(join(configDir, "settings.json"), JSON.stringify({ mcp: { http: { enabled: true }, stdio: { enabled: false }, readOnly: false } }));
    const { app, initialAdminPassword } = await buildApp(workspace, { configDir, adminPassword: "chosen-password" });
    expect(initialAdminPassword).toBeUndefined();
    const b = browser(app);
    expect((await b.login("mariorossi", "chosen-password")).body.user).toMatchObject({ name: "Mario Rossi", role: "owner" });
    await b.call("POST", "/api/auth/password", { currentPassword: "chosen-password", newPassword: "another-password" });
    expect((await b.call("GET", "/api/settings/mcp")).body.stdio.enabled).toBe(false);
  });

  it("blocks cross-site writes and repeated wrong passwords", async () => {
    const { app, owner } = await setup();
    expect((await owner.call("POST", "/api/projects", { name: "X" }, {})).status).toBe(403); // no x-sourcebook-client
    const b = browser(app);
    for (let i = 0; i < 5; i++) await b.login("admin", "wrong");
    expect((await b.login("admin", "owner-pass-2")).status).toBe(429);
  });
});

describe("users and access", () => {
  it("shows each user only their projects; read access can comment but not edit", async () => {
    const { app, owner } = await setup();
    await owner.call("POST", "/api/projects", { name: "Alpha" });
    await owner.call("POST", "/api/projects", { name: "Beta" });
    const block = (await owner.call("POST", "/api/projects/alpha/blocks", { title: "Intro" })).body;
    const sub = (await owner.call("POST", `/api/projects/alpha/blocks/${block.id}/subblocks`, { type: "markdown" })).body;
    const mario = await addUser(app, owner, "mario");
    const luca = await addUser(app, owner, "luca");
    await owner.call("PUT", "/api/access/projects/alpha", { access: { mario: "write", luca: "read" } });

    expect((await mario.call("GET", "/api/projects")).body.map((p: { id: string; access: string }) => [p.id, p.access])).toEqual([["alpha", "write"]]);
    expect((await luca.call("GET", "/api/projects")).body.map((p: { access: string }) => p.access)).toEqual(["read"]);
    expect((await luca.call("GET", "/api/projects/beta/notebook")).status).toBe(404);
    expect((await luca.call("GET", "/api/projects/beta")).status).toBe(404);

    const subUrl = `/api/projects/alpha/blocks/${block.id}/subblocks/${sub.id}`;
    expect((await luca.call("PATCH", subUrl, { content: { markdown: "x" } })).status).toBe(403);
    const c = await luca.call("POST", `${subUrl}/comments`, { text: "Unclear", author: { name: "Fake", username: "fake" } });
    expect(c.body.author).toEqual({ name: "LUCA", username: "luca", kind: "user" }); // the session signs, not the body
    expect((await mario.call("PATCH", subUrl, { content: { markdown: "Better" } })).status).toBe(200);
    const mc = (await mario.call("POST", `${subUrl}/comments`, { text: "Fixed" })).body;
    expect((await luca.call("DELETE", `${subUrl}/comments/${mc.id}`)).status).toBe(403); // not theirs
    expect((await luca.call("POST", `${subUrl}/comments/${c.body.id}/resolve`)).status).toBe(200);

    // Creating projects is a permission; the creator gets write access.
    expect((await mario.call("POST", "/api/projects", { name: "Mine" })).status).toBe(403);
    await owner.call("PATCH", "/api/users/mario", { canCreateProjects: true });
    expect((await mario.call("POST", "/api/projects", { name: "Mine" })).status).toBe(201);
    expect((await mario.call("GET", "/api/projects")).body.map((p: { id: string }) => p.id).sort()).toEqual(["alpha", "mine"]);
    expect((await mario.call("DELETE", "/api/projects/mine")).status).toBe(403); // owner only

    // Only the owner manages users and access; disabling signs the user out.
    expect((await mario.call("POST", "/api/users", { username: "x", name: "X", password: "temporary-1" })).status).toBe(403);
    expect((await mario.call("GET", "/api/access")).status).toBe(403);
    await owner.call("PATCH", "/api/users/luca", { disabled: true });
    expect((await luca.call("GET", "/api/projects")).status).toBe(401);
    expect((await owner.call("PATCH", "/api/users/admin", { disabled: true })).status).toBe(400);
  });

  it("keeps the read state of notifications per user", async () => {
    const { app, owner } = await setup();
    await owner.call("POST", "/api/projects", { name: "Alpha" });
    const block = (await owner.call("POST", "/api/projects/alpha/blocks", { title: "Intro" })).body;
    const mario = await addUser(app, owner, "mario");
    await owner.call("PUT", "/api/access/projects/alpha", { access: { mario: "read" } });
    const n = (await owner.call("POST", "/api/projects/alpha/notifications", { summary: "Changed", targets: [{ blockId: block.id }] })).body;
    await mario.call("POST", `/api/projects/alpha/notifications/${n.id}/read`);
    expect((await mario.call("GET", "/api/projects/alpha/notifications")).body.notifications[0].read).toBe(true);
    expect((await owner.call("GET", "/api/projects/alpha/notifications")).body.notifications[0].read).toBe(false);
  });
});

describe("agents", () => {
  /** An MCP client connected with `token` (one configuration for all of a user's agents). */
  const mcpClient = async (app: App, token: string) => {
    const server = createSourcebookMcpServer(injectApi(app as unknown as Injectable, "http", { token }));
    const [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    const client = new Client({ name: "t", version: "1" });
    await client.connect(c);
    return async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { text: r.content.map((x) => x.text).join("\n"), isError: !!r.isError };
    };
  };

  it("share one user token: each call names its agent, signed on behalf of the user, with the user's rights", async () => {
    const { app, owner } = await setup();
    await owner.call("POST", "/api/projects", { name: "Alpha" });
    await owner.call("POST", "/api/projects/alpha/blocks", { title: "Intro" });
    const mario = await addUser(app, owner, "mario");
    await owner.call("PUT", "/api/access/projects/alpha", { access: { mario: "read" } });

    const created = await mario.call("POST", "/api/tokens", { label: "Laptop" });
    expect(created.status).toBe(201);
    const token: string = created.body.token;
    expect(token).toMatch(/^sbu_/);
    expect(JSON.stringify((await mario.call("GET", "/api/tokens")).body)).not.toContain(token);

    const call = await mcpClient(app, token);
    // No agent yet: reading works, signing does not; the assistant can register its identities.
    expect((await call("whoami")).text).toContain("You have no agent identity yet");
    expect((await call("list_workspace")).text).toContain("alpha");
    expect((await call("register_agent", { id: "writer", name: "Writer agent" })).text).toContain("default agent");
    await mario.call("POST", "/api/agents", { id: "reviewer", name: "Reviewer" });
    expect((await mario.call("POST", "/api/agents", { id: "mario", name: "Clash" })).status).toBe(409); // a username
    expect((await owner.call("POST", "/api/agents", { id: "other", name: "writer agent" })).status).toBe(409); // a name

    expect((await call("whoami")).text).toContain("You sign as Writer agent (@writer, agent of MARIO)");
    expect((await call("whoami", { agent: "reviewer" })).text).toContain("You sign as Reviewer (@reviewer, agent of MARIO)");
    expect((await call("create_section", { project: "alpha", title: "No" })).text).toMatch(/403.*read-only/); // mario's rights
    await owner.call("PUT", "/api/access/projects/alpha", { access: { mario: "write" } });
    await call("add_subblock", { project: "alpha", section: "§1", type: "markdown", content: "Hello" });
    expect((await call("add_comment", { project: "alpha", subblock: "§1#1", text: "Draft ready" })).text).toContain("as Writer agent (@writer, agent of MARIO)");
    expect((await call("add_comment", { project: "alpha", subblock: "§1#1", text: "Too long", agent: "reviewer" })).text).toContain("as Reviewer (@reviewer, agent of MARIO)");
    // Only the user's own agents.
    await owner.call("POST", "/api/agents", { id: "owner-bot", name: "Owner bot" });
    expect((await call("add_comment", { project: "alpha", subblock: "§1#1", text: "x", agent: "owner-bot" })).text).toMatch(/not one of your agents/);
    const participants = (await call("list_participants", { project: "alpha" })).text;
    expect(participants).toContain('Writer agent — id "writer" · agent of MARIO · 1 contribution(s)');
    expect(participants).toContain('Reviewer — id "reviewer" · agent of MARIO · 1 contribution(s)');

    // Another default; revoking the token stops every agent of the connection.
    await mario.call("POST", "/api/agents/reviewer/default");
    expect((await call("whoami")).text).toContain("You sign as Reviewer");
    await mario.call("DELETE", `/api/tokens/${created.body.info.id}`);
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/mcp", headers: { host: "127.0.0.1:4000", "content-type": "application/json" }, payload: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).statusCode).toBe(401);
  });

  it("access tokens and agents are managed by their user (signed in), or the owner", async () => {
    const { app, owner } = await setup();
    const mario = await addUser(app, owner, "mario");
    const { token, info } = (await mario.call("POST", "/api/tokens", { label: "CI" })).body;
    const bearer = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: "POST", url: "/api/tokens", headers: bearer, payload: { label: "x" } })).statusCode).toBe(403); // not with a token
    expect((await app.inject({ method: "POST", url: "/api/auth/password", headers: bearer, payload: { currentPassword: "a", newPassword: "bbbbbbbbb" } })).statusCode).toBe(403);
    // A script with the token and no agent acts as the user.
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: bearer })).json()).toMatchObject({ user: { username: "mario" }, via: "token" });
    expect((await owner.call("GET", "/api/tokens?all=1")).body.tokens.map((t: { owner: string }) => t.owner)).toEqual(["mario"]);
    expect((await owner.call("DELETE", `/api/tokens/${info.id}`)).body.revoked).toBe(true);
    await owner.call("PATCH", "/api/users/mario", { disabled: true });
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: bearer })).statusCode).toBe(401);
  });
});

describe("deleting an agent", () => {
  it("removes its comments, replies, resolutions, notifications, locks and picture everywhere, and frees its id", async () => {
    const { app, owner } = await setup();
    await owner.call("POST", "/api/projects", { name: "Alpha" });
    const block = (await owner.call("POST", "/api/projects/alpha/blocks", { title: "Intro" })).body;
    const sub = (await owner.call("POST", `/api/projects/alpha/blocks/${block.id}/subblocks`, { type: "markdown" })).body;
    const mario = await addUser(app, owner, "mario");
    await owner.call("PUT", "/api/access/projects/alpha", { access: { mario: "write" } });
    await mario.call("POST", "/api/agents", { id: "writer", name: "Writer" });
    const token = (await mario.call("POST", "/api/tokens", { label: "MCP" })).body.token;
    const asWriter = (method: string, url: string, payload?: object) =>
      app.inject({ method: method as "GET", url, payload: payload as Record<string, unknown>, headers: { authorization: `Bearer ${token}`, "x-sourcebook-agent": "writer" } }).then((r) => r.json());
    const comments = `/api/projects/alpha/blocks/${block.id}/subblocks/${sub.id}/comments`;

    const own = await asWriter("POST", comments, { text: "Writer's thread" });
    await mario.call("POST", `${comments}/${own.id}/replies`, { text: "Mario answers" });
    const marios = (await mario.call("POST", comments, { text: "Mario's thread" })).body;
    await asWriter("POST", `${comments}/${marios.id}/replies`, { text: "Writer replies" });
    await asWriter("POST", `${comments}/${marios.id}/resolve`);
    await asWriter("POST", "/api/projects/alpha/notifications", { summary: "Wrote things", targets: [] });
    await asWriter("POST", `/api/projects/alpha/blocks/${block.id}/subblocks/${sub.id}/lock`);
    const { createCanvas } = await import("@napi-rs/canvas");
    await mario.call("PUT", "/api/avatars/writer", { image: (await createCanvas(10, 10).encode("png")).toString("base64") });

    const preview = (await mario.call("GET", "/api/agents/writer/footprint")).body;
    expect(preview.total).toEqual({ threads: 1, replies: 1, resolutions: 1, notifications: 1, locks: 1 });
    expect(preview.projects.map((p: { name: string }) => p.name)).toEqual(["Alpha"]);
    expect((await mario.call("GET", comments)).body.comments).toHaveLength(2); // the preview changes nothing

    await otherUserCannotDelete(app, owner);
    const removed = (await mario.call("POST", "/api/agents/writer/delete")).body;
    expect(removed.total).toEqual(preview.total);
    const left = (await mario.call("GET", comments)).body.comments;
    expect(left.map((c: { text: string; replies: unknown[]; resolution?: unknown }) => [c.text, c.replies.length, !!c.resolution])).toEqual([["Mario's thread", 0, false]]);
    expect((await mario.call("GET", "/api/projects/alpha/notifications")).body.notifications).toEqual([]);
    expect((await mario.call("GET", "/api/projects/alpha/locks")).body.locks).toEqual([]);
    expect((await mario.call("GET", "/api/avatars")).body.avatars).not.toHaveProperty("writer");
    expect((await mario.call("GET", "/api/agents")).body.agents).toEqual([]);
    // The id is free again.
    expect((await owner.call("POST", "/api/agents", { id: "writer", name: "Writer" })).status).toBe(201);
  });
});

/** Only the agent's user (or the owner) can delete it. */
async function otherUserCannotDelete(app: App, owner: ReturnType<typeof browser>) {
  const luca = await addUser(app, owner, "luca");
  expect((await luca.call("POST", "/api/agents/writer/delete")).status).toBe(403);
}

describe("pictures", () => {
  it("stores square 256 px pictures of users and their agents; only the owner changes anyone's", async () => {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const wide = createCanvas(300, 100);
    wide.getContext("2d").fillRect(0, 0, 300, 100);
    const image = `data:image/png;base64,${(await wide.encode("png")).toString("base64")}`;
    const { app, owner } = await setup();
    const mario = await addUser(app, owner, "mario");
    await mario.call("POST", "/api/agents", { id: "writer", name: "Writer" });

    expect((await mario.call("PUT", "/api/avatars/mario", { image })).body.avatars).toHaveProperty("mario");
    expect((await mario.call("PUT", "/api/avatars/writer", { image })).status).toBe(200);
    expect((await mario.call("PUT", "/api/avatars/admin", { image })).status).toBe(403);
    expect((await owner.call("PUT", "/api/avatars/mario", { image })).status).toBe(200);
    expect((await mario.call("PUT", "/api/avatars/mario", { image: "bm90IGFuIGltYWdl" })).status).toBe(400);
    expect((await mario.call("PUT", "/api/avatars/nobody", { image })).status).toBe(403);

    const res = await app.inject({ method: "GET", url: "/api/avatars/writer", headers: { cookie: mario.cookie } });
    expect(res.headers["content-type"]).toBe("image/webp");
    const stored = await loadImage(res.rawPayload);
    expect([stored.width, stored.height]).toEqual([256, 256]);
    expect(Object.keys((await owner.call("GET", "/api/avatars")).body.avatars).sort()).toEqual(["mario", "writer"]);
    await mario.call("DELETE", "/api/avatars/writer");
    expect((await app.inject({ method: "GET", url: "/api/avatars/writer", headers: { cookie: mario.cookie } })).statusCode).toBe(404);
  });
});

describe("locks", () => {
  it("lets one person or agent take a sub-block; others get 423 until it is released or the owner unlocks it", async () => {
    const { app, owner } = await setup();
    await owner.call("POST", "/api/projects", { name: "Alpha" });
    const block = (await owner.call("POST", "/api/projects/alpha/blocks", { title: "Intro" })).body;
    const sub = (await owner.call("POST", `/api/projects/alpha/blocks/${block.id}/subblocks`, { type: "markdown" })).body;
    const mario = await addUser(app, owner, "mario");
    const luca = await addUser(app, owner, "luca");
    await owner.call("PUT", "/api/access/projects/alpha", { access: { mario: "write", luca: "write" } });
    await mario.call("POST", "/api/agents", { id: "writer", name: "Writer" });
    const token = (await mario.call("POST", "/api/tokens", { label: "MCP" })).body.token;
    const asAgent = (method: string, url: string, payload?: object) =>
      app.inject({ method: method as "GET", url, payload: payload as Record<string, unknown>, headers: { authorization: `Bearer ${token}`, "x-sourcebook-agent": "writer" } });

    const subUrl = `/api/projects/alpha/blocks/${block.id}/subblocks/${sub.id}`;
    expect((await asAgent("POST", `${subUrl}/lock`)).json().holder).toMatchObject({ username: "writer", onBehalfOf: { username: "mario" } });
    expect((await luca.call("POST", `${subUrl}/lock`)).status).toBe(409);
    expect((await luca.call("PATCH", subUrl, { content: { markdown: "mine" } })).status).toBe(423);
    expect((await luca.call("DELETE", `/api/projects/alpha/blocks/${block.id}`)).status).toBe(423);
    expect((await luca.call("POST", `${subUrl}/comments`, { text: "Comments still work" })).status).toBe(201);
    expect((await asAgent("PATCH", subUrl, { content: { markdown: "agent text" } })).statusCode).toBe(200);
    expect((await luca.call("DELETE", `${subUrl}/lock`)).status).toBe(403);
    expect((await owner.call("GET", "/api/projects/alpha/locks")).body.locks).toHaveLength(1);

    // The user an agent works for may release its locks; the owner may force any.
    expect((await mario.call("DELETE", `${subUrl}/lock`)).status).toBe(204);
    await luca.call("POST", `${subUrl}/lock`);
    expect((await owner.call("DELETE", `${subUrl}/lock`)).status).toBe(403);
    expect((await owner.call("DELETE", `${subUrl}/lock?force=1`)).status).toBe(204);
    expect((await owner.call("GET", "/api/projects/alpha/locks")).body.locks).toEqual([]);
  });
});

describe("base path", () => {
  it("serves everything under the prefix, with a session cookie scoped to it", async () => {
    const { app, owner } = await setup({ basePath: "/marco/sourcebook", publicUrl: "https://example.org/marco/sourcebook" });
    expect((await owner.call("POST", "/api/projects", { name: "Alpha" })).status).toBe(201);
    expect((await app.inject({ method: "GET", url: "/api/projects" })).statusCode).toBe(404);
    const login = await browser(app, "/marco/sourcebook").login("admin", "owner-pass-2");
    expect(String(login.headers["set-cookie"])).toMatch(/^sourcebook_session_marco_sourcebook=.*Path=\/marco\/sourcebook; HttpOnly; SameSite=Strict; Secure/);
    const mcp = (await owner.call("GET", "/api/settings/mcp")).body;
    expect(mcp.connection.http.url).toBe("https://example.org/marco/sourcebook/mcp");
    expect((await app.inject({ method: "GET", url: "/" })).headers.location).toBe("/marco/sourcebook/");
  });

  it("serves the built client with the base path injected", async () => {
    const dist = await tempProject();
    await mkdir(join(dist, "assets"), { recursive: true });
    await writeFile(join(dist, "index.html"), "<html><head><title>x</title></head><body></body></html>");
    await writeFile(join(dist, "assets", "app.js"), "console.log(1)");
    const { app } = await setup({ basePath: "/team", clientDist: dist });
    const index = await app.inject({ method: "GET", url: "/team/" });
    expect(index.body).toContain('<script>window.__SOURCEBOOK__={"basePath":"/team"}</script></head>');
    expect((await app.inject({ method: "GET", url: "/team/assets/app.js" })).body).toBe("console.log(1)");
    expect((await app.inject({ method: "GET", url: "/team" })).headers.location).toBe("/team/");
    expect(existsSync(join(dist, "index.html"))).toBe(true);
  });
});
