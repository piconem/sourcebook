import { z } from "zod";

export const IdSchema = z.string().min(1).max(64);

/** Entry of notebook.json — flat list in depth-first order; hierarchy via parentId. */
export const NotebookEntrySchema = z.object({
  id: IdSchema,
  title: z.string(),
  parentId: IdSchema.nullable(),
  order: z.number().int().nonnegative(),
  folder: z.string(),
});
export type NotebookEntry = z.infer<typeof NotebookEntrySchema>;

export const NotebookIndexSchema = z.object({
  version: z.literal(1),
  blocks: z.array(NotebookEntrySchema),
});
export type NotebookIndex = z.infer<typeof NotebookIndexSchema>;

/** Optional free text explaining why a section or sub-block exists (exported as a Markdown comment). */
export const ObjectiveSchema = z.string().max(20_000);

export const SubBlockRefSchema = z.object({
  id: IdSchema,
  type: z.string().min(1),
  /** Optional short title shown above the sub-block. */
  title: z.string().max(200).optional(),
  objective: ObjectiveSchema.optional(),
  order: z.number().int().nonnegative(),
  /** Source file name inside the block's `subblocks/` folder. */
  source: z.string(),
  /** Exported artifact file names (e.g. PNG) inside `subblocks/`. */
  exports: z.array(z.string()),
  props: z.record(z.string(), z.unknown()),
  /** Content revision, incremented on every content change (optimistic concurrency, live sync). */
  rev: z.number().int().nonnegative().optional(),
  /** Bibliography keys associated with the whole sub-block. */
  citations: z.array(z.string()).optional(),
  /** Reference files (paths inside references/) associated with the whole sub-block. */
  references: z.array(z.string()).optional(),
});
export type SubBlockRef = z.infer<typeof SubBlockRefSchema>;

/** Contents of a block folder's block.json. */
export const BlockMetaSchema = z.object({
  id: IdSchema,
  title: z.string(),
  objective: ObjectiveSchema.optional(),
  /** Bibliography keys associated with the whole section. */
  citations: z.array(z.string()).optional(),
  /** Reference files (paths inside references/) associated with the whole section. */
  references: z.array(z.string()).optional(),
  parentId: IdSchema.nullable(),
  order: z.number().int().nonnegative(),
  subBlocks: z.array(SubBlockRefSchema),
});
export type BlockMeta = z.infer<typeof BlockMetaSchema>;

export const AssetFileSchema = z.object({
  ext: z.string().regex(/^[a-z0-9]{1,8}$/),
  mimeType: z.string(),
  dataBase64: z.string(),
});
export type AssetFile = z.infer<typeof AssetFileSchema>;

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

// ---- API response shapes ----

export interface SubBlock extends SubBlockRef {
  content: unknown;
  /** Number of top-level comments (threads) on the sub-block. */
  commentCount?: number;
}

export interface Block extends Omit<BlockMeta, "subBlocks"> {
  folder: string;
  subBlocks: SubBlock[];
}

export interface Project {
  name: string;
  blocks: (NotebookEntry & { subBlocks: SubBlockRef[] })[];
}

// ---- API payloads ----

export const BlockIdParamsSchema = z.object({ id: IdSchema });
export const SubBlockParamsSchema = z.object({ blockId: IdSchema, subBlockId: IdSchema });
export const BlockFilesParamsSchema = z.object({ id: IdSchema, "*": z.string() });

export const CreateBlockBodySchema = z.object({
  title: z.string().min(1),
  parentId: IdSchema.nullable().optional(),
  /** Index among siblings; appended when omitted. */
  position: z.number().int().nonnegative().optional(),
});
export type CreateBlockBody = z.infer<typeof CreateBlockBodySchema>;

export const UpdateBlockBodySchema = z
  .object({
    title: z.string().min(1).optional(),
    parentId: IdSchema.nullable().optional(),
    /** Empty string removes the objective. */
    objective: ObjectiveSchema.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Nothing to update");
export type UpdateBlockBody = z.infer<typeof UpdateBlockBodySchema>;

export const ReorderBlocksBodySchema = z.object({
  /** Every block, in depth-first order, with its (possibly new) parent. */
  blocks: z.array(z.object({ id: IdSchema, parentId: IdSchema.nullable() })),
});
export type ReorderBlocksBody = z.infer<typeof ReorderBlocksBodySchema>;

export const CreateSubBlockBodySchema = z.object({
  type: z.string().min(1),
  position: z.number().int().nonnegative().optional(),
  content: z.unknown().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  title: z.string().max(200).optional(),
  objective: ObjectiveSchema.optional(),
});
export type CreateSubBlockBody = z.infer<typeof CreateSubBlockBodySchema>;

export const UpdateSubBlockBodySchema = z.object({
  content: z.unknown().optional(),
  /** Empty string removes the title / objective. */
  title: z.string().max(200).optional(),
  objective: ObjectiveSchema.optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  /** Exported artifacts rendered by the client; replace all previous exports. */
  exports: z.array(AssetFileSchema).optional(),
  /** Reject (409) when the stored revision differs: the content changed since it was read. */
  expectedRev: z.number().int().nonnegative().optional(),
});

/** Surgical edits of a sub-block's source text, applied atomically on the server. */
export const TextEditSchema = z.union([
  z.object({
    /** Exact text to replace; must occur exactly once unless `all` is set. */
    find: z.string().min(1),
    replace: z.string(),
    all: z.boolean().optional(),
  }),
  z.object({
    /** 1-based source lines to replace (inclusive) with `text` (may be empty to delete them). */
    lines: z
      .object({ first: z.number().int().min(1), last: z.number().int().min(0) })
      .refine((l) => l.last >= l.first - 1, "lines.last must be ≥ lines.first - 1 (first - 1 inserts before first)"),
    text: z.string(),
  }),
]);
export type TextEdit = z.infer<typeof TextEditSchema>;

export const EditSubBlockBodySchema = z.object({
  edits: z.array(TextEditSchema).min(1).max(200),
  expectedRev: z.number().int().nonnegative().optional(),
});
export type EditSubBlockBody = z.infer<typeof EditSubBlockBodySchema>;
export type UpdateSubBlockBody = z.infer<typeof UpdateSubBlockBodySchema>;

export const ReorderSubBlocksBodySchema = z.object({ order: z.array(IdSchema) });
export type ReorderSubBlocksBody = z.infer<typeof ReorderSubBlocksBodySchema>;

export interface UploadAssetResponse {
  /** Path relative to the block folder, e.g. "assets/ab12.png". */
  path: string;
  /** URL the client can use to display the asset. */
  url: string;
}

export const DeleteSubBlockQuerySchema = z.object({
  /** Also delete asset files referenced only by this sub-block. */
  deleteAssets: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

export interface DeleteSubBlockResult {
  deletedAssets: string[];
  /** Assets left in place because other sub-blocks still reference them. */
  keptAssets: string[];
}

/** What deleting a block would remove (the block, its nested blocks and their asset files). */
export interface BlockDeletionImpact {
  blocks: { id: string; title: string }[];
  /** Project-relative paths of files under the affected blocks' assets/ folders. */
  assets: string[];
}

// ---- References (project input files) ----

export interface ReferenceNode {
  name: string;
  /** Path relative to the references/ folder, "/"-separated. Empty for the root. */
  path: string;
  kind: "file" | "dir";
  size?: number;
  modified?: string;
  /** Files: whether the assistant can read it via MCP (natively, or through converted Markdown). */
  mcp?: import("./mcpContent.js").McpInfo;
  children?: ReferenceNode[];
}

export const ReferencePathSchema = z.string().max(1000);
export const CreateReferenceFolderBodySchema = z.object({ path: ReferencePathSchema.min(1) });
export const RenameReferenceBodySchema = z.object({
  path: ReferencePathSchema.min(1),
  /** New name only (no separators): renaming never moves an entry to another folder. */
  newName: z.string().min(1).max(255),
});
export const ReferencePathQuerySchema = z.object({ path: ReferencePathSchema.min(1) });
export const UploadReferencesQuerySchema = z.object({ dir: ReferencePathSchema.default("") });

export const ReferencePathsBodySchema = z.object({
  paths: z.array(ReferencePathSchema.min(1)).min(1).max(10_000),
});

/** Reference files associated with a whole section or sub-block (replaces the list). */
export const AttachReferencesBodySchema = z.object({ paths: z.array(ReferencePathSchema.min(1)).max(500) });

export const ZipReferencesBodySchema = ReferencePathsBodySchema.extend({
  /** Folder the entries are made relative to (usually the folder being browsed). */
  base: ReferencePathSchema.default(""),
});

// ---- User profile & comments ----

/** Lower-case handle, e.g. "mariorossi" (letters, digits, dot, dash, underscore). */
export const UsernameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,38}$/, "Use 1–39 lower-case letters, digits, '.', '-' or '_' (starting with a letter or digit)");

export const AuthorSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  username: UsernameSchema,
  /** "assistant" for comments written by an AI assistant (e.g. through MCP). */
  kind: z.enum(["user", "assistant"]).optional(),
});
export type Author = z.infer<typeof AuthorSchema>;

export const UserProfileSchema = AuthorSchema.omit({ kind: true });
export type UserProfile = z.infer<typeof UserProfileSchema>;

/**
 * Where a comment points inside a text-based sub-block (W3C Web Annotation "text quote" style):
 * the quoted text plus some context, and the start offset as a hint. Resolved client-side by searching
 * the current text, so anchors survive edits elsewhere; if the quote is gone the comment is "detached".
 * unit "text": any range of the rendered text (Markdown); "lines": whole lines of the source (Code).
 */
export const CommentAnchorSchema = z.object({
  unit: z.enum(["text", "lines"]),
  exact: z.string().min(1).max(5000),
  prefix: z.string().max(200).default(""),
  suffix: z.string().max(200).default(""),
  /** Character offset of the quote when the anchor was made (tie-breaker between occurrences). */
  start: z.number().int().nonnegative().optional(),
});
export type CommentAnchor = z.infer<typeof CommentAnchorSchema>;

/**
 * API convenience: designate source lines instead of quoting text. The server turns it into a quote
 * anchor (for Markdown, the visible text of those lines of the .md file).
 */
export const LineSelectorSchema = z.object({
  lines: z
    .object({ first: z.number().int().min(1), last: z.number().int().min(1) })
    .refine((l) => l.last >= l.first, "lines.last must be ≥ lines.first"),
});
export type LineSelector = z.infer<typeof LineSelectorSchema>;

export const AnchorInputSchema = z.union([CommentAnchorSchema, LineSelectorSchema]);
export type AnchorInput = z.infer<typeof AnchorInputSchema>;

export const CommentReplySchema = z.object({
  id: IdSchema,
  author: AuthorSchema,
  /** ISO timestamp set by the server. */
  createdAt: z.string(),
  text: z.string(),
});
export type CommentReply = z.infer<typeof CommentReplySchema>;

/** Who closed a thread and when ("resolved": nothing left to do). */
export const CommentResolutionSchema = z.object({ by: AuthorSchema, at: z.string() });
export type CommentResolution = z.infer<typeof CommentResolutionSchema>;

export const CommentSchema = CommentReplySchema.extend({
  /** Absent for comments on the whole sub-block. */
  anchor: CommentAnchorSchema.optional(),
  replies: z.array(CommentReplySchema),
  /** Present when the thread is resolved; open threads have none. */
  resolution: CommentResolutionSchema.optional(),
});
export type Comment = z.infer<typeof CommentSchema>;

/** Contents of a sub-block's `<base>.comments.json`. */
export const CommentsFileSchema = z.object({
  version: z.literal(1),
  comments: z.array(CommentSchema),
});
export type CommentsFile = z.infer<typeof CommentsFileSchema>;

export const CreateCommentBodySchema = z.object({
  text: z.string().trim().min(1, "Comment is empty").max(10_000),
  /** Defaults to the current user profile. */
  author: AuthorSchema.optional(),
});
export type CreateCommentBody = z.infer<typeof CreateCommentBodySchema>;

export const CreateThreadBodySchema = CreateCommentBodySchema.extend({
  /** Anchors the comment to text/lines (quote or source line range); only for types with `commentAnchor`. */
  anchor: AnchorInputSchema.optional(),
});

export const UpdateCommentBodySchema = z.object({
  /** New anchor (re-attach), or null to turn it into a comment on the whole sub-block. */
  anchor: AnchorInputSchema.nullable(),
});

/** A comment as returned by the API: anchored ones say where their quote is found now. */
export type CommentView = Comment & {
  /** Current source lines of the quote; null when it no longer exists (detached). Absent if not anchored. */
  resolved?: { lines: { first: number; last: number } } | null;
};

export const ResolveCommentBodySchema = z.object({
  /** Defaults to the current user profile. */
  author: AuthorSchema.optional(),
});

/** A thread in the project-wide comment list (document order), with where it is. */
export interface ProjectCommentThread {
  blockId: string;
  sectionTitle: string;
  subBlockId: string;
  /** 1-based position of the sub-block in its section (the "#3" of §2.1#3). */
  subBlockIndex: number;
  subBlockType: string;
  subBlockTitle?: string;
  comment: CommentView;
}

export const ProjectCommentsQuerySchema = z.object({ status: z.enum(["open", "resolved", "all"]).default("all") });

export const CommentParamsSchema = SubBlockParamsSchema.extend({ commentId: IdSchema });
export const ReplyParamsSchema = CommentParamsSchema.extend({ replyId: IdSchema });

// ---- Workspace: projects & templates ----

/** Projects and templates are the same kind of folder, kept in two collections. */
export const NotebookKindSchema = z.enum(["projects", "templates"]);
export type NotebookKind = z.infer<typeof NotebookKindSchema>;

/** Folder name used as id: lower-case slug. */
export const ProjectIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "Invalid project id");

export const ProjectMetaSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().max(2000).default(""),
  createdAt: z.string(),
  /** What this project/template was created from, if anything. */
  createdFrom: z.object({ kind: NotebookKindSchema, id: z.string(), name: z.string() }).optional(),
});
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;

export interface ProjectSummary extends ProjectMeta {
  id: string;
  kind: NotebookKind;
  /** Latest modification of any file in the folder. */
  updatedAt: string;
  sections: number;
}

export const CreateProjectBodySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().max(2000).optional(),
  /** Start from a copy of another project/template (comments are not copied). */
  from: z.object({ kind: NotebookKindSchema, id: ProjectIdSchema }).optional(),
});
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;

export const UpdateProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
  })
  .refine((b) => b.name !== undefined || b.description !== undefined, "Nothing to update");
export type UpdateProjectBody = z.infer<typeof UpdateProjectBodySchema>;

// ---- Change notifications (sent by external applications / assistants) ----

/** A part of the project a notification is about: a section, one of its sub-blocks, or a comment on it. */
export const ChangeTargetSchema = z
  .object({
    blockId: IdSchema,
    subBlockId: IdSchema.optional(),
    commentId: IdSchema.optional(),
    /** What changed there, in a few words. */
    note: z.string().trim().max(500).optional(),
  })
  .refine((t) => !t.commentId || t.subBlockId, "commentId requires subBlockId");
export type ChangeTarget = z.infer<typeof ChangeTargetSchema>;

export const CreateNotificationBodySchema = z.object({
  /** Defaults to the current user profile. */
  author: AuthorSchema.optional(),
  /** Short description of the whole change. */
  summary: z.string().trim().min(1, "Summary is empty").max(300),
  targets: z.array(ChangeTargetSchema).max(50).default([]),
  /** Also ask open editors to reload (e.g. at the end of a group of changes). */
  requestReload: z.boolean().optional(),
});
export type CreateNotificationBody = z.input<typeof CreateNotificationBodySchema>;

export const NotificationSchema = z.object({
  id: IdSchema,
  createdAt: z.string(),
  author: AuthorSchema,
  summary: z.string(),
  /** Each target with its label when the notification was received (e.g. "§2.1#3 Markdown"). */
  targets: z.array(z.object({ blockId: IdSchema, subBlockId: IdSchema.optional(), commentId: IdSchema.optional(), note: z.string().optional(), label: z.string() })),
  read: z.boolean(),
});
export type Notification = z.infer<typeof NotificationSchema>;
export type NotificationTarget = Notification["targets"][number];

/** Contents of a project's notifications.json (newest first). */
export const NotificationsFileSchema = z.object({ version: z.literal(1), notifications: z.array(NotificationSchema) });

export const NotificationParamsSchema = z.object({ notificationId: IdSchema });

export const ReloadRequestBodySchema = z.object({
  author: AuthorSchema.optional(),
  /** Shown to the user in the reload dialog. */
  message: z.string().trim().max(500).optional(),
  /** Notifications that describe the changes (default: the unread ones). */
  notificationIds: z.array(IdSchema).max(200).optional(),
});
export type ReloadRequestBody = z.infer<typeof ReloadRequestBodySchema>;

// ---- Live events ----

/** Change notification streamed to open editors (Server-Sent Events). */
export interface NotebookEvent {
  type: "blocks" | "block" | "subblock" | "comments" | "references" | "bibliography" | "notifications" | "reload";
  blockId?: string;
  subBlockId?: string;
  /** New content revision (subblock events). */
  rev?: number;
  /** Reload requests: who asks, why, and the notifications describing the changes. */
  author?: Author;
  message?: string;
  notificationIds?: string[];
  /** Client that caused the change (value of the x-sourcebook-client header), e.g. "mcp". */
  origin: string;
}

// ---- MCP settings ----

export const McpSettingsSchema = z.object({
  http: z.object({ enabled: z.boolean() }),
  stdio: z.object({ enabled: z.boolean() }),
  /** The assistant may only read (every MCP write is refused by the server). */
  readOnly: z.boolean(),
});
export type McpSettings = z.infer<typeof McpSettingsSchema>;

export const UpdateMcpSettingsBodySchema = z.object({
  http: z.object({ enabled: z.boolean() }).optional(),
  stdio: z.object({ enabled: z.boolean() }).optional(),
  readOnly: z.boolean().optional(),
});
export type UpdateMcpSettingsBody = z.infer<typeof UpdateMcpSettingsBodySchema>;

/** Settings plus what an LLM client needs to connect (computed by the server). */
export interface McpSettingsView extends McpSettings {
  connection: {
    http: { url: string };
    stdio: { command: string; args: string[]; cwd: string; env: Record<string, string> };
  };
}

/** Header sent by the MCP server with every API call ("stdio" | "http"), used to apply the settings. */
export const MCP_TRANSPORT_HEADER = "x-sourcebook-mcp-transport";
