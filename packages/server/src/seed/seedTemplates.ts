import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectMeta, Registry, SubBlockTypeCore } from "@sourcebook/shared";
import { readJson, writeJsonAtomic } from "../fs/atomic.js";
import { PROJECT_FILE } from "../store/WorkspaceStore.js";
import { DEMO_TEMPLATE, buildDemoTemplate } from "./demoTemplate.js";
import { SPEC_TEMPLATE_IDS, buildFromSpec, loadSpec } from "./specTemplates.js";

const SEEDED_FILE = "seeded.json";

/** Templates shipped with Sourcebook: the demo tour, then the example templates. */
const BUNDLED = [
  { ...DEMO_TEMPLATE, build: buildDemoTemplate },
  ...SPEC_TEMPLATE_IDS.map((id) => {
    const spec = loadSpec(id);
    return { id, name: spec.name, description: spec.description, build: (dir: string, registry: Registry<SubBlockTypeCore<any>>) => buildFromSpec(dir, registry, spec) };
  }),
];

/**
 * Adds the bundled templates to the workspace, each once: `<dataDir>/seeded.json` remembers which ones were added,
 * so a template the owner deleted does not come back, and a new version of Sourcebook can add new ones.
 * A folder with the same id already in the workspace is left alone. Returns the ids added.
 */
export async function seedTemplates(workspaceDir: string, dataDir: string, registry: Registry<SubBlockTypeCore<any>>): Promise<string[]> {
  const file = join(dataDir, SEEDED_FILE);
  const seeded = new Set<string>(existsSync(file) ? (((await readJson(file).catch(() => null)) as { templates?: string[] } | null)?.templates ?? []) : []);
  const added: string[] = [];
  for (const tpl of BUNDLED) {
    if (seeded.has(tpl.id)) continue;
    const dir = join(workspaceDir, "templates", tpl.id);
    if (!existsSync(dir)) {
      // Built aside, then moved in: a half-built template never shows up in the list.
      const staging = join(workspaceDir, "templates", `.seed-${tpl.id}`);
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      try {
        await tpl.build(staging, registry);
        const meta: ProjectMeta = { name: tpl.name, description: tpl.description, createdAt: new Date().toISOString() };
        await writeJsonAtomic(join(staging, PROJECT_FILE), meta);
        await rename(staging, dir);
      } catch (e) {
        await rm(staging, { recursive: true, force: true });
        throw e;
      }
      added.push(tpl.id);
    }
    seeded.add(tpl.id);
  }
  if (added.length || !existsSync(file)) await writeJsonAtomic(file, { version: 1, templates: [...seeded] }, 0o600);
  return added;
}
