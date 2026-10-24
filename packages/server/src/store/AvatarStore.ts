import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { badRequest } from "../errors.js";
import { writeFileAtomic } from "../fs/atomic.js";

/** Side of the stored pictures (px). */
export const AVATAR_SIZE = 256;
const MAX_UPLOAD = 5 * 1024 * 1024;

/**
 * Profile pictures of users and agents (`.sourcebook/avatars/<id>.webp`). Whatever is uploaded is cropped to the
 * central square and scaled to 256×256 here too, so every picture is a small square (shown in a circle).
 */
export class AvatarStore {
  readonly dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, "avatars");
  }

  file(id: string): string {
    return join(this.dir, `${id}.webp`);
  }

  /** id → version (modification time), for cache-busting URLs. */
  async list(): Promise<Record<string, number>> {
    if (!existsSync(this.dir)) return {};
    const out: Record<string, number> = {};
    for (const name of await readdir(this.dir)) {
      if (!name.endsWith(".webp")) continue;
      out[name.slice(0, -5)] = Math.round((await stat(join(this.dir, name))).mtimeMs);
    }
    return out;
  }

  async save(id: string, data: Uint8Array): Promise<void> {
    if (data.length > MAX_UPLOAD) throw badRequest("The picture is larger than 5 MB");
    const { loadImage, createCanvas } = await import("@napi-rs/canvas");
    const img = await loadImage(Buffer.from(data)).catch(() => {
      throw badRequest("Not an image (use PNG, JPEG, WebP or GIF)");
    });
    const side = Math.min(img.width, img.height);
    if (!side) throw badRequest("Empty image");
    const canvas = createCanvas(AVATAR_SIZE, AVATAR_SIZE);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.file(id), await canvas.encode("webp", 88), 0o600);
  }

  async remove(id: string): Promise<void> {
    await rm(this.file(id), { force: true });
  }
}
