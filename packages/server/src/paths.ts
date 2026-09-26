import { fileURLToPath } from "node:url";

/** Root of the Sourcebook repository (this file is packages/server/src/paths.ts). */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
