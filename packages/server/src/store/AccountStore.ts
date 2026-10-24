import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  UsernameSchema,
  type AccessLevel,
  type AccessTokenView,
  type AccountView,
  type AgentView,
  type Author,
  type CreateUserBody,
  type NotebookKind,
  type Role,
  type UpdateUserBody,
  type UserProfile,
} from "@sourcebook/shared";
import { HttpError, badRequest, notFound } from "../errors.js";
import { readJson, writeJsonAtomic } from "../fs/atomic.js";
import { Mutex } from "../fs/mutex.js";

/** Hidden folder of the workspace with accounts, access rights, agents, sessions and settings. */
export const DATA_DIR = ".sourcebook";
const FILE_MODE = 0o600;

interface Account {
  username: string;
  name: string;
  role: Role;
  canCreateProjects: boolean;
  disabled: boolean;
  mustChangePassword: boolean;
  /** "scrypt$N$r$p$<salt b64>$<hash b64>" */
  password: string;
  createdAt: string;
}

interface Agent {
  id: string;
  name: string;
  owner: string;
  /** Agents of earlier versions had a token of their own (sha256, hex); new agents use their user's token. */
  tokenHash?: string;
  tokenPrefix?: string;
  default?: boolean;
  createdAt: string;
  lastUsedAt?: string;
  revoked: boolean;
}

/** A user's personal access token. */
interface AccessToken {
  id: string;
  label: string;
  owner: string;
  /** sha256 of the token (hex). */
  hash: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
  revoked: boolean;
}

interface Session {
  username: string;
  createdAt: string;
  expiresAt: string;
}

const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const AGENT_TOKEN_PREFIX = "sbk_";
const USER_TOKEN_PREFIX = "sbu_";

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const randomToken = () => randomBytes(32).toString("base64url");
export const generatePassword = () => randomBytes(12).toString("base64url");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const key = await scrypt(password, salt, keylen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(key, expected);
}

/** Who makes a request: a user, or an agent working on behalf of one. */
export interface Principal {
  user: AccountView;
  agent?: AgentView;
  author: Author;
  /** How it authenticated: web session, the user's access token, or an agent's own token (older versions). */
  via: "session" | "token" | "agent-token";
}

/**
 * Users (with scrypt password hashes), project access rights, agents (with token hashes) and web sessions,
 * in `<workspace>/.sourcebook/` (folder 0700, files 0600). Everything is kept in memory and written atomically.
 * Only hashes are stored: passwords and tokens are never written.
 */
export class AccountStore {
  private mutex = new Mutex();
  readonly dir: string;
  private users: Account[] = [];
  private agents: Agent[] = [];
  private tokens: AccessToken[] = [];
  /** "projects/<id>" → username → level */
  private access: Record<string, Record<string, AccessLevel>> = {};
  /** sha256(session token) → session */
  private sessions: Record<string, Session> = {};
  private lastUseWrite = 0;

  constructor(workspace: string) {
    this.dir = join(workspace, DATA_DIR);
  }

  private file(name: string) {
    return join(this.dir, name);
  }

  private async readFile<T>(name: string, key: string, fallback: T): Promise<T> {
    if (!existsSync(this.file(name))) return fallback;
    const raw = (await readJson(this.file(name))) as Record<string, unknown>;
    return (raw?.[key] as T) ?? fallback;
  }

  private save(name: "accounts.json" | "agents.json" | "tokens.json" | "access.json" | "sessions.json") {
    const content =
      name === "accounts.json" ? { version: 1, users: this.users }
      : name === "agents.json" ? { version: 1, agents: this.agents }
      : name === "tokens.json" ? { version: 1, tokens: this.tokens }
      : name === "access.json" ? { version: 1, access: this.access }
      : { version: 1, sessions: this.sessions };
    return writeJsonAtomic(this.file(name), content, FILE_MODE);
  }

  /**
   * Loads the files; on the first start creates the owner account (`owner` profile, `password` or a generated
   * one, to be changed at the first login). Returns the generated password, if any, to show once.
   */
  async load(bootstrap: { owner: UserProfile; password?: string }): Promise<{ generatedPassword?: string; created: boolean }> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700).catch(() => undefined);
    if (!existsSync(this.file(".gitignore"))) await writeFile(this.file(".gitignore"), "# Accounts, sessions and settings of this Sourcebook: never commit them.\n*\n");
    this.users = await this.readFile("accounts.json", "users", []);
    this.agents = await this.readFile("agents.json", "agents", []);
    this.tokens = await this.readFile("tokens.json", "tokens", []);
    this.access = await this.readFile("access.json", "access", {});
    this.sessions = await this.readFile("sessions.json", "sessions", {});
    const now = new Date().toISOString();
    for (const [k, s] of Object.entries(this.sessions)) if (s.expiresAt < now) delete this.sessions[k];
    if (this.users.length) return { created: false };
    const generatedPassword = bootstrap.password ? undefined : generatePassword();
    this.users.push({
      username: bootstrap.owner.username,
      name: bootstrap.owner.name,
      role: "owner",
      canCreateProjects: true,
      disabled: false,
      mustChangePassword: true,
      password: await hashPassword(bootstrap.password ?? generatedPassword!),
      createdAt: now,
    });
    await this.save("accounts.json");
    return { generatedPassword, created: true };
  }

  // ---- users ----

  private view(a: Account): AccountView {
    const { password: _, ...rest } = a;
    return { ...rest, canCreateProjects: a.role === "owner" || a.canCreateProjects };
  }

  listUsers(): AccountView[] {
    return this.users.map((u) => this.view(u));
  }

  getUser(username: string): AccountView | undefined {
    const u = this.users.find((x) => x.username === username);
    return u && this.view(u);
  }

  owner(): AccountView {
    return this.view(this.users.find((u) => u.role === "owner")!);
  }

  /** Username + password → the account, or null (also for disabled accounts). */
  async authenticate(username: string, password: string): Promise<AccountView | null> {
    const u = this.users.find((x) => x.username === username.toLowerCase());
    // Hash anyway so timing does not reveal whether the user exists.
    const ok = await verifyPassword(password, u?.password ?? (await hashPassword("x")));
    return u && ok && !u.disabled ? this.view(u) : null;
  }

  private taken(id: string) {
    return this.users.some((u) => u.username === id) || this.agents.some((a) => a.id === id);
  }

  createUser(body: CreateUserBody): Promise<AccountView> {
    return this.mutex.run(async () => {
      const username = UsernameSchema.parse(body.username);
      if (this.taken(username)) throw new HttpError(409, `"${username}" is already used by a user or an agent`);
      const account: Account = {
        username,
        name: body.name,
        role: body.role ?? "member",
        canCreateProjects: !!body.canCreateProjects,
        disabled: false,
        mustChangePassword: true,
        password: await hashPassword(body.password),
        createdAt: new Date().toISOString(),
      };
      this.users.push(account);
      await this.save("accounts.json");
      return this.view(account);
    });
  }

  updateUser(username: string, body: UpdateUserBody): Promise<AccountView> {
    return this.mutex.run(async () => {
      const u = this.users.find((x) => x.username === username);
      if (!u) throw notFound(`User ${username}`);
      const owners = this.users.filter((x) => x.role === "owner" && !x.disabled);
      const losesOwner = u.role === "owner" && ((body.role && body.role !== "owner") || body.disabled);
      if (losesOwner && owners.length === 1) throw badRequest("There must be at least one active owner");
      if (body.name !== undefined) u.name = body.name;
      if (body.role !== undefined) u.role = body.role;
      if (body.canCreateProjects !== undefined) u.canCreateProjects = body.canCreateProjects;
      if (body.disabled !== undefined) u.disabled = body.disabled;
      if (body.password !== undefined) {
        u.password = await hashPassword(body.password);
        u.mustChangePassword = true;
      }
      // Disabling or resetting the password signs the user out everywhere.
      if (body.disabled || body.password !== undefined) this.dropSessions(username);
      await this.save("accounts.json");
      await this.save("sessions.json");
      return this.view(u);
    });
  }

  deleteUser(username: string): Promise<void> {
    return this.mutex.run(async () => {
      const u = this.users.find((x) => x.username === username);
      if (!u) throw notFound(`User ${username}`);
      if (u.role === "owner" && this.users.filter((x) => x.role === "owner").length === 1) throw badRequest("The last owner cannot be deleted");
      this.users = this.users.filter((x) => x !== u);
      for (const a of this.agents) if (a.owner === username) a.revoked = true;
      for (const t of this.tokens) if (t.owner === username) t.revoked = true;
      for (const grants of Object.values(this.access)) delete grants[username];
      this.dropSessions(username);
      await Promise.all([this.save("accounts.json"), this.save("agents.json"), this.save("tokens.json"), this.save("access.json"), this.save("sessions.json")]);
    });
  }

  changePassword(username: string, current: string, next: string): Promise<void> {
    return this.mutex.run(async () => {
      const u = this.users.find((x) => x.username === username);
      if (!u) throw notFound(`User ${username}`);
      if (!(await verifyPassword(current, u.password))) throw new HttpError(403, "The current password is wrong");
      if (current === next) throw badRequest("Choose a password different from the current one");
      u.password = await hashPassword(next);
      u.mustChangePassword = false;
      await this.save("accounts.json");
    });
  }

  // ---- sessions ----

  private dropSessions(username: string) {
    for (const [k, s] of Object.entries(this.sessions)) if (s.username === username) delete this.sessions[k];
  }

  createSession(username: string): Promise<{ token: string; expiresAt: string }> {
    return this.mutex.run(async () => {
      const token = randomToken();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400_000).toISOString();
      this.sessions[sha256(token)] = { username, createdAt: now.toISOString(), expiresAt };
      await this.save("sessions.json");
      return { token, expiresAt };
    });
  }

  deleteSession(token: string): Promise<void> {
    return this.mutex.run(async () => {
      delete this.sessions[sha256(token)];
      await this.save("sessions.json");
    });
  }

  /** The user of a valid session (sliding expiry), or null. */
  sessionUser(token: string): AccountView | null {
    const key = sha256(token);
    const s = this.sessions[key];
    if (!s) return null;
    const now = Date.now();
    if (Date.parse(s.expiresAt) < now) {
      delete this.sessions[key];
      return null;
    }
    const u = this.users.find((x) => x.username === s.username);
    if (!u || u.disabled) return null;
    // Renew at most once a day.
    if (Date.parse(s.expiresAt) - now < (SESSION_DAYS - 1) * 86400_000) {
      s.expiresAt = new Date(now + SESSION_DAYS * 86400_000).toISOString();
      void this.mutex.run(() => this.save("sessions.json"));
    }
    return this.view(u);
  }

  // ---- agents: identities registered by users ----

  private agentView(a: Agent): AgentView {
    return {
      id: a.id,
      name: a.name,
      owner: a.owner,
      ownerName: this.users.find((u) => u.username === a.owner)?.name ?? a.owner,
      default: !!a.default && !a.revoked,
      ...(a.tokenPrefix ? { tokenPrefix: a.tokenPrefix } : {}),
      createdAt: a.createdAt,
      ...(a.lastUsedAt ? { lastUsedAt: a.lastUsedAt } : {}),
      revoked: a.revoked,
    };
  }

  listAgents(owner?: string): AgentView[] {
    return this.agents.filter((a) => !owner || a.owner === owner).map((a) => this.agentView(a));
  }

  /** Registers an agent identity for `owner`; the first one becomes their default. */
  createAgent(owner: string, id: string, name: string): Promise<AgentView> {
    return this.mutex.run(async () => {
      const agentId = UsernameSchema.parse(id);
      if (this.taken(agentId)) throw new HttpError(409, `"${agentId}" is already used by a user or an agent`);
      const sameName = this.agents.find((a) => !a.revoked && a.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (sameName) throw new HttpError(409, `The name "${name}" is already used by the agent ${sameName.id}`);
      const first = !this.agents.some((a) => a.owner === owner && !a.revoked);
      const agent: Agent = { id: agentId, name: name.trim(), owner, default: first, createdAt: new Date().toISOString(), revoked: false };
      this.agents.push(agent);
      await this.save("agents.json");
      return this.agentView(agent);
    });
  }

  /** Makes an agent its user's default (used when a call names no agent). */
  setDefaultAgent(id: string): Promise<AgentView> {
    return this.mutex.run(async () => {
      const a = this.agents.find((x) => x.id === id && !x.revoked);
      if (!a) throw notFound(`Agent ${id}`);
      for (const other of this.agents) if (other.owner === a.owner) other.default = other === a;
      await this.save("agents.json");
      return this.agentView(a);
    });
  }

  revokeAgent(id: string): Promise<AgentView> {
    return this.mutex.run(async () => {
      const a = this.agents.find((x) => x.id === id);
      if (!a) throw notFound(`Agent ${id}`);
      a.revoked = true;
      // Another agent of the same user takes over as default.
      if (a.default) {
        a.default = false;
        const next = this.agents.find((x) => x.owner === a.owner && !x.revoked);
        if (next) next.default = true;
      }
      await this.save("agents.json");
      return this.agentView(a);
    });
  }

  /** Deletes an agent for good: its id becomes free again. */
  deleteAgent(id: string): Promise<void> {
    return this.mutex.run(async () => {
      const a = this.agents.find((x) => x.id === id);
      if (!a) throw notFound(`Agent ${id}`);
      this.agents = this.agents.filter((x) => x !== a);
      if (a.default && !a.revoked) {
        const next = this.agents.find((x) => x.owner === a.owner && !x.revoked);
        if (next) next.default = true;
      }
      await this.save("agents.json");
    });
  }

  getAgent(id: string): AgentView | undefined {
    const a = this.agents.find((x) => x.id === id);
    return a && this.agentView(a);
  }

  /** The agent `id` (default agent without id) of `user`, or an explanation of why there is none. */
  agentOf(user: AccountView, id?: string): AgentView {
    const mine = this.agents.filter((a) => a.owner === user.username && !a.revoked);
    const a = id ? mine.find((x) => x.id === id) : (mine.find((x) => x.default) ?? mine[0]);
    if (a) {
      this.touch(a);
      return this.agentView(a);
    }
    const list = mine.map((x) => x.id).join(", ");
    if (id) throw new HttpError(403, `"${id}" is not one of your agents${list ? ` (${list})` : ""}: register it first (Settings → My agents, or the register_agent tool)`);
    throw new HttpError(403, "You have no agents yet: register one (Settings → My agents, or the register_agent tool) so the assistant has an identity");
  }

  private touch(x: { lastUsedAt?: string }) {
    x.lastUsedAt = new Date().toISOString();
    if (Date.now() - this.lastUseWrite > 60_000) {
      this.lastUseWrite = Date.now();
      void this.mutex.run(async () => {
        await this.save("agents.json");
        await this.save("tokens.json");
      });
    }
  }

  /** Older versions: an agent with a token of its own. Null when revoked, unknown or its user is disabled. */
  agentByToken(token: string): { agent: AgentView; user: AccountView } | null {
    if (!token.startsWith(AGENT_TOKEN_PREFIX)) return null;
    const hash = sha256(token);
    const a = this.agents.find((x) => x.tokenHash === hash && !x.revoked);
    const u = a && this.users.find((x) => x.username === a.owner && !x.disabled);
    if (!a || !u) return null;
    this.touch(a);
    return { agent: this.agentView(a), user: this.view(u) };
  }

  // ---- personal access tokens ----

  private tokenView(t: AccessToken): AccessTokenView {
    const { hash: _, ...rest } = t;
    return { ...rest, ownerName: this.users.find((u) => u.username === t.owner)?.name ?? t.owner };
  }

  listTokens(owner?: string): AccessTokenView[] {
    return this.tokens.filter((t) => !owner || t.owner === owner).map((t) => this.tokenView(t));
  }

  /** A new access token for `owner`; the token itself is returned only here. */
  createToken(owner: string, label: string): Promise<{ token: string; info: AccessTokenView }> {
    return this.mutex.run(async () => {
      const token = USER_TOKEN_PREFIX + randomToken();
      const t: AccessToken = { id: randomBytes(6).toString("base64url"), label: label.trim(), owner, hash: sha256(token), prefix: token.slice(0, 10), createdAt: new Date().toISOString(), revoked: false };
      this.tokens.push(t);
      await this.save("tokens.json");
      return { token, info: this.tokenView(t) };
    });
  }

  revokeToken(id: string): Promise<AccessTokenView> {
    return this.mutex.run(async () => {
      const t = this.tokens.find((x) => x.id === id);
      if (!t) throw notFound(`Token ${id}`);
      t.revoked = true;
      await this.save("tokens.json");
      return this.tokenView(t);
    });
  }

  getToken(id: string): AccessTokenView | undefined {
    const t = this.tokens.find((x) => x.id === id);
    return t && this.tokenView(t);
  }

  /** The user of a valid access token, or null (revoked, unknown, user disabled). */
  userByToken(token: string): AccountView | null {
    if (!token.startsWith(USER_TOKEN_PREFIX)) return null;
    const hash = sha256(token);
    const t = this.tokens.find((x) => x.hash === hash && !x.revoked);
    const u = t && this.users.find((x) => x.username === t.owner && !x.disabled);
    if (!t || !u) return null;
    this.touch(t);
    return this.view(u);
  }

  // ---- access to projects / templates ----

  accessLevel(user: AccountView, kind: NotebookKind, id: string): AccessLevel | null {
    if (user.role === "owner") return "write";
    return this.access[`${kind}/${id}`]?.[user.username] ?? null;
  }

  accessOf(kind: NotebookKind, id: string): Record<string, AccessLevel> {
    return { ...(this.access[`${kind}/${id}`] ?? {}) };
  }

  setAccess(kind: NotebookKind, id: string, changes: Record<string, AccessLevel | null>): Promise<Record<string, AccessLevel>> {
    return this.mutex.run(async () => {
      const key = `${kind}/${id}`;
      const grants = { ...(this.access[key] ?? {}) };
      for (const [username, level] of Object.entries(changes)) {
        if (!this.users.some((u) => u.username === username)) throw badRequest(`Unknown user ${username}`);
        if (level) grants[username] = level;
        else delete grants[username];
      }
      if (Object.keys(grants).length) this.access[key] = grants;
      else delete this.access[key];
      await this.save("access.json");
      return { ...grants };
    });
  }

  /** A project/template was deleted: forget its access rights. */
  forget(kind: NotebookKind, id: string): Promise<void> {
    return this.mutex.run(async () => {
      if (!this.access[`${kind}/${id}`]) return;
      delete this.access[`${kind}/${id}`];
      await this.save("access.json");
    });
  }
}

/** Signature of a principal: the user, or the agent with the user it works for. */
export function authorOf(user: AccountView, agent?: AgentView): Author {
  return agent
    ? { name: agent.name, username: agent.id, kind: "assistant", onBehalfOf: { username: user.username, name: user.name } }
    : { name: user.name, username: user.username, kind: "user" };
}
