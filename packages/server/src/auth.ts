import { AGENT_HEADER, type AccessLevel, type Author } from "@sourcebook/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { HttpError } from "./errors.js";
import { authorOf, type AccountStore, type Principal } from "./store/AccountStore.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Who makes the request (set for /api and /mcp by the auth hook). */
    principal: Principal;
    /** Access level of the principal to the project/template of the URL (project-scoped routes). */
    access: AccessLevel;
  }
  interface FastifyContextConfig {
    /** Minimum access to the project for this route (default: read for GET/HEAD, write otherwise). */
    access?: AccessLevel;
  }
}

export interface AuthOptions {
  /** false: single-user mode (tests); every request acts as the owner and may sign with a given author. */
  enabled: boolean;
  accounts: AccountStore;
  basePath: string;
  /** Session cookie: Secure flag (https public URL). */
  secureCookie: boolean;
}

/** Session cookie name: one per base path, so several Sourcebooks on one domain keep separate sessions. */
export const sessionCookieName = (basePath: string) => `sourcebook_session${basePath ? `_${basePath.slice(1).replace(/[^A-Za-z0-9]/g, "_")}` : ""}`;

function cookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function setSessionCookie(reply: FastifyReply, opts: AuthOptions, token: string | null, expiresAt?: string) {
  const attrs = [
    `${sessionCookieName(opts.basePath)}=${token ? encodeURIComponent(token) : ""}`,
    `Path=${opts.basePath || "/"}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(opts.secureCookie ? ["Secure"] : []),
    token && expiresAt ? `Expires=${new Date(expiresAt).toUTCString()}` : "Max-Age=0",
  ];
  reply.header("set-cookie", attrs.join("; "));
}

export const sessionToken = (req: FastifyRequest, opts: AuthOptions) => cookie(req, sessionCookieName(opts.basePath));

const bearer = (req: FastifyRequest) => /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ""))?.[1];

/** Login attempts per username+IP: after 5 failures, wait (doubling up to 15 minutes). */
export class LoginThrottle {
  private failures = new Map<string, { count: number; until: number }>();

  check(key: string) {
    const f = this.failures.get(key);
    if (f && f.until > Date.now()) throw new HttpError(429, `Too many failed attempts: try again in ${Math.ceil((f.until - Date.now()) / 1000)} s`);
  }

  fail(key: string) {
    const f = this.failures.get(key) ?? { count: 0, until: 0 };
    f.count++;
    if (f.count >= 5) f.until = Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (f.count - 5));
    this.failures.set(key, f);
  }

  succeed(key: string) {
    this.failures.delete(key);
  }
}

/** Paths reachable without signing in (relative to the base path). */
const PUBLIC = new Set(["/api/auth/login", "/api/auth/me", "/api/auth/logout"]);
/** Reachable while a password change is required. */
const PASSWORD_CHANGE = new Set(["/api/auth/me", "/api/auth/logout", "/api/auth/password"]);

/**
 * Resolves the principal of /api and /mcp requests: a web session (cookie) or an agent token (Bearer).
 * Requests with the session cookie that change something must carry x-sourcebook-client (sent by the web
 * client, not by cross-site forms): together with SameSite=Strict this blocks CSRF.
 */
export function authHook(opts: AuthOptions) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.slice(opts.basePath.length).split("?")[0];
    if (!path.startsWith("/api/") && path !== "/mcp") return;
    if (!opts.enabled) {
      const owner = opts.accounts.owner();
      req.principal = { user: owner, author: authorOf(owner), via: "session" };
      return;
    }
    const token = bearer(req);
    if (token) {
      // An agent's own token (older versions).
      const legacy = opts.accounts.agentByToken(token);
      if (legacy) {
        req.principal = { user: legacy.user, agent: legacy.agent, author: authorOf(legacy.user, legacy.agent), via: "agent-token" };
        return;
      }
      const user = opts.accounts.userByToken(token);
      if (!user) throw new HttpError(401, "Invalid or revoked access token");
      req.principal = { user, author: authorOf(user), via: "token" };
      // The agent acting in this call: named by the MCP server (or a script); MCP calls default to the user's
      // default agent, so what an assistant does is never signed as the person.
      const named = [req.headers[AGENT_HEADER]].flat()[0];
      const mcp = req.headers["x-sourcebook-client"] === "mcp";
      if (named || (mcp && path !== "/mcp")) {
        try {
          const agent = opts.accounts.agentOf(user, named || undefined);
          req.principal = { user, agent, author: authorOf(user, agent), via: "token" };
        } catch (e) {
          // No agent yet: the assistant may still read, learn who it is and register one.
          const setup = req.method === "GET" || path === "/api/agents";
          if (named || !setup) throw e;
        }
      }
      return;
    }
    const session = sessionToken(req, opts);
    const user = session ? opts.accounts.sessionUser(session) : null;
    if (user) {
      if (req.method !== "GET" && req.method !== "HEAD" && !req.headers["x-sourcebook-client"]) {
        throw new HttpError(403, "Missing x-sourcebook-client header");
      }
      req.principal = { user, author: authorOf(user), via: "session" };
      if (user.mustChangePassword && !PASSWORD_CHANGE.has(path)) throw new HttpError(403, "Change your password first", { code: "password_change_required" });
      return;
    }
    if (PUBLIC.has(path)) return;
    throw new HttpError(401, path === "/mcp" ? "Sourcebook needs your access token: Authorization: Bearer sbu_… (Settings → My agents)" : "Sign in first");
  };
}

/** The author of what this request signs. Single-user mode keeps honouring an explicit author (MCP connection identity). */
export function requestAuthor(req: FastifyRequest, explicit: Author | undefined, authEnabled: boolean): Author {
  if (!authEnabled && explicit) return explicit;
  return req.principal.author;
}

export function requireOwner(req: FastifyRequest) {
  if (req.principal?.user.role !== "owner") throw new HttpError(403, "Only the owner of this Sourcebook can do this");
}
