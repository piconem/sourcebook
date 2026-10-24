import { readFileSync } from "node:fs";
import type { CreateSubBlockBody, Registry, SubBlockTypeCore } from "@sourcebook/shared";
import { NotebookStore } from "../store/NotebookStore.js";

/** A template written as data (templates/<id>.json): sections with their objective, sub-blocks and sub-sections. */
export interface TemplateSpec {
  name: string;
  description: string;
  sections: SectionSpec[];
}
interface SectionSpec {
  title: string;
  objective?: string;
  subs?: CreateSubBlockBody[];
  children?: SectionSpec[];
}

/** The example templates shipped as JSON next to this file (also used by scripts/create-example-templates.py). */
export const SPEC_TEMPLATE_IDS = ["software-project", "scientific-paper", "research-project-proposal", "thesis"] as const;

export const loadSpec = (id: string): TemplateSpec => JSON.parse(readFileSync(new URL(`./templates/${id}.json`, import.meta.url), "utf8"));

/** Writes a template described by `spec` into `dir` (an empty folder), validating every sub-block. */
export async function buildFromSpec(dir: string, registry: Registry<SubBlockTypeCore<any>>, spec: TemplateSpec): Promise<void> {
  const store = await NotebookStore.open(dir, registry);
  const add = async (sections: SectionSpec[], parentId: string | null) => {
    for (const s of sections) {
      const block = await store.createBlock({ title: s.title, parentId });
      if (s.objective) await store.updateBlock(block.id, { objective: s.objective });
      for (const sub of s.subs ?? []) await store.addSubBlock(block.id, sub);
      await add(s.children ?? [], block.id);
    }
  };
  await add(spec.sections, null);
}
