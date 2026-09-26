import { randomBytes } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";

/** Write via temp file + rename so readers never see a half-written file. */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export const writeJsonAtomic = (path: string, value: unknown) =>
  writeFileAtomic(path, JSON.stringify(value, null, 2) + "\n");

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}
