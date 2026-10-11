import type { NotificationTarget, Project } from "@sourcebook/shared";
import { outlineNumbers, withDepth } from "../tree";
import { registry } from "../subblocks";

/**
 * Current label of a notification target ("§2.1 Title", "§2.1#3 Markdown", "Comment on …"): outline numbers
 * change when sections move, so the label stored with the notification is only used for deleted parts.
 */
export function targetLabel(project: Project | undefined, t: NotificationTarget): { label: string; exists: boolean } {
  const section = project?.blocks.find((b) => b.id === t.blockId);
  if (!project || !section) return { label: t.label, exists: false };
  const n = `§${outlineNumbers(withDepth(project.blocks)).get(section.id)}`;
  if (!t.subBlockId) return { label: `${n} ${section.title}`, exists: true };
  const index = section.subBlocks.findIndex((s) => s.id === t.subBlockId);
  if (index < 0) return { label: t.label, exists: false };
  const sub = section.subBlocks[index];
  const label = `${n}#${index + 1} ${sub.title || registry.get(sub.type)?.label || sub.type}`;
  return { label: t.commentId ? `Comment on ${label}` : label, exists: true };
}
