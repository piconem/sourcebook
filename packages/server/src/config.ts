import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

/** "/", "marco/sourcebook/", "/marco//sourcebook" → "" (root) or "/marco/sourcebook". */
export function normalizeBasePath(value: string | undefined): string {
  const segments = (value ?? "").split("/").filter(Boolean);
  for (const s of segments) if (!/^[A-Za-z0-9._~-]+$/.test(s)) throw new Error(`Invalid base path segment "${s}"`);
  return segments.length ? `/${segments.join("/")}` : "";
}

const truthy = (v: string | undefined) => ["1", "true", "yes", "on"].includes(String(v ?? "").toLowerCase());

export interface ServerConfig {
  /** Folder holding projects/, templates/ and .sourcebook/ (accounts, settings). */
  workspace: string;
  host: string;
  port: number;
  /** URL prefix without trailing slash ("" at the root), e.g. "/marco/sourcebook". */
  basePath: string;
  /** Address users reach Sourcebook at (behind a proxy), including the base path, without trailing slash. */
  publicUrl: string;
  /** Initial password of the owner account (first start only). */
  adminPassword?: string;
  /** Behind a reverse proxy: trust X-Forwarded-* (client IP, https). */
  trustProxy: boolean;
}

const PortSchema = z.coerce.number().int().min(1).max(65535);

/** Startup configuration: command-line options, then environment variables, then defaults. */
export function loadConfig(argv = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const { values } = parseArgs({
    args: argv,
    options: {
      workspace: { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      "base-path": { type: "string" },
      "public-url": { type: "string" },
    },
  });
  const port = PortSchema.parse(values.port ?? env.PORT ?? 4000);
  const host = values.host ?? env.SOURCEBOOK_HOST ?? "127.0.0.1";
  const basePath = normalizeBasePath(values["base-path"] ?? env.SOURCEBOOK_BASE_PATH);
  const publicUrl = (values["public-url"] ?? env.SOURCEBOOK_PUBLIC_URL ?? `http://${host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host}:${port}${basePath}`).replace(/\/+$/, "");
  z.string().url().parse(publicUrl);
  return {
    workspace: resolve(values.workspace ?? env.SOURCEBOOK_WORKSPACE ?? join(homedir(), "Sourcebook")),
    host,
    port,
    basePath,
    publicUrl,
    adminPassword: env.SOURCEBOOK_ADMIN_PASSWORD || undefined,
    trustProxy: truthy(env.SOURCEBOOK_TRUST_PROXY),
  };
}
