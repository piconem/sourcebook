import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { UserProfileSchema, type UserProfile } from "@sourcebook/shared";
import { readJson, writeJsonAtomic } from "../fs/atomic.js";

/** Per-person settings live outside projects: $SOURCEBOOK_CONFIG_DIR, else $XDG_CONFIG_HOME/sourcebook, else ~/.config/sourcebook. */
export function defaultConfigDir(): string {
  if (process.env.SOURCEBOOK_CONFIG_DIR) return process.env.SOURCEBOOK_CONFIG_DIR;
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "sourcebook");
}

function osProfile(): UserProfile {
  let login = "user";
  try {
    login = userInfo().username || login;
  } catch {
    // no passwd entry (containers): keep the fallback
  }
  const username = login.toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+/, "").slice(0, 39) || "user";
  return { name: login, username };
}

/** The current user's profile (display name + username), used as author of comments. */
export class UserStore {
  private readonly path: string;

  constructor(private readonly configDir = defaultConfigDir()) {
    this.path = join(configDir, "user.json");
  }

  async get(): Promise<UserProfile> {
    if (!existsSync(this.path)) return osProfile();
    const parsed = UserProfileSchema.safeParse(await readJson(this.path).catch(() => null));
    return parsed.success ? parsed.data : osProfile();
  }

  async set(profile: UserProfile): Promise<UserProfile> {
    await mkdir(this.configDir, { recursive: true });
    await writeJsonAtomic(this.path, profile);
    return profile;
  }
}
