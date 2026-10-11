import { filenameFrom } from "../download";
import type {
  AssetFromReferenceResult,
  ReferenceImageSource,
  ReferenceImages,
  McpContent,
  McpInfo,
  McpManifest,
  BibEntry,
  BibUsage,
  CreateBibEntryBody,
  ImportBibResult,
  UpdateBibEntryBody,
  Block,
  BlockDeletionImpact,
  CreateProjectBody,
  McpSettingsView,
  UpdateMcpSettingsBody,
  NotebookKind,
  ProjectSummary,
  UpdateProjectBody,
  Comment,
  CommentAnchor,
  CommentReply,
  Notification,
  ProjectCommentThread,
  UserProfile,
  CreateBlockBody,
  CreateSubBlockBody,
  DeleteSubBlockResult,
  NotebookEntry,
  Project,
  ReferenceNode,
  ReorderBlocksBody,
  SubBlock,
  SubBlockRef,
  UpdateBlockBody,
  UpdateSubBlockBody,
  UploadAssetResponse,
} from "@sourcebook/shared";

/**
 * Base URL of the project/template being edited (`/api/projects/<id>` or `/api/templates/<id>`);
 * every notebook call goes through it. Set when a project or template is opened.
 */
let nbBase = "/api/projects/_";
export function setNotebookBase(kind: NotebookKind, id: string) {
  nbBase = `/api/${kind}/${encodeURIComponent(id)}`;
}
export const notebookBase = () => nbBase;

/** Identifies this browser tab in live events (its own changes are not echoed back as "external"). */
export const CLIENT_ID = `web-${Math.random().toString(36).slice(2, 10)}`;

/** fetch() tagged with this tab's client id. */
export function apiFetch(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), "x-sourcebook-client": CLIENT_ID } });
}

/** sourcebook:// URI of an element of the open project/template, e.g. sections/<id>. */
export const notebookUri = (path: string) => `sourcebook:/${nbBase.replace(/^\/api/, "")}/${path}`;

const commentsUrl = (blockId: string, subBlockId: string) => `${nbBase}/blocks/${blockId}/subblocks/${subBlockId}/comments`;

export interface TemplateImportPreview {
  valid: true;
  name: string;
  description: string;
  sections: number;
  subBlocks: number;
  references: number;
  warnings: string[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiFetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, err.error ?? res.statusText, err.details);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  getProject: () => request<Project>("GET", `${nbBase}/notebook`),
  getBlock: (id: string) => request<Block>("GET", `${nbBase}/blocks/${id}`),
  createBlock: (body: CreateBlockBody) => request<NotebookEntry>("POST", `${nbBase}/blocks`, body),
  updateBlock: (id: string, body: UpdateBlockBody) => request<NotebookEntry>("PATCH", `${nbBase}/blocks/${id}`, body),
  deleteBlock: (id: string) => request<void>("DELETE", `${nbBase}/blocks/${id}`),
  reorderBlocks: (body: ReorderBlocksBody) => request<Project>("PATCH", `${nbBase}/blocks/reorder`, body),
  blockDeletionImpact: (id: string) => request<BlockDeletionImpact>("GET", `${nbBase}/blocks/${id}/deletion-impact`),
  getExport: () => request<{ fileName: string; markdown: string; files: string[] }>("GET", `${nbBase}/export`),
  async getExportZip(): Promise<Blob> {
    const res = await apiFetch(`${nbBase}/export.zip`);
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return res.blob();
  },

  addSubBlock: (blockId: string, body: CreateSubBlockBody) =>
    request<SubBlock>("POST", `${nbBase}/blocks/${blockId}/subblocks`, body),
  updateSubBlock: (blockId: string, subBlockId: string, body: UpdateSubBlockBody) =>
    request<SubBlock>("PATCH", `${nbBase}/blocks/${blockId}/subblocks/${subBlockId}`, body),
  reorderSubBlocks: (blockId: string, order: string[]) =>
    request<SubBlockRef[]>("PATCH", `${nbBase}/blocks/${blockId}/subblocks/reorder`, { order }),
  deleteSubBlock: (blockId: string, subBlockId: string, deleteAssets = false) =>
    request<DeleteSubBlockResult>(
      "DELETE",
      `${nbBase}/blocks/${blockId}/subblocks/${subBlockId}?deleteAssets=${deleteAssets}`,
    ),

  deleteAsset: (blockId: string, assetPath: string) =>
    request<void>("DELETE", `${nbBase}/blocks/${blockId}/assets/${encodeURIComponent(assetPath.replace(/^assets\//, ""))}`),

  // ---- workspace: projects & templates ----
  listNotebooks: (kind: NotebookKind) => request<ProjectSummary[]>("GET", `/api/${kind}`),
  getNotebookSummary: (kind: NotebookKind, id: string) => request<ProjectSummary>("GET", `/api/${kind}/${encodeURIComponent(id)}`),
  createNotebook: (kind: NotebookKind, body: CreateProjectBody) => request<ProjectSummary>("POST", `/api/${kind}`, body),
  updateNotebook: (kind: NotebookKind, id: string, body: UpdateProjectBody) =>
    request<ProjectSummary>("PATCH", `/api/${kind}/${encodeURIComponent(id)}`, body),
  deleteNotebook: (kind: NotebookKind, id: string) => request<void>("DELETE", `/api/${kind}/${encodeURIComponent(id)}`),

  /** Template as a ZIP archive (manifest + folder, comments excluded). */
  async exportTemplate(id: string): Promise<{ blob: Blob; name: string }> {
    const res = await apiFetch(`/api/templates/${encodeURIComponent(id)}/archive.zip`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, err.error ?? res.statusText);
    }
    return { blob: await res.blob(), name: filenameFrom(res.headers.get("content-disposition"), `${id}.zip`) };
  },

  /**
   * Validates (`dryRun`) or imports a template ZIP. Invalid archives reject with an ApiError whose
   * `details` is `{ errors: string[], warnings: string[] }`.
   */
  async importTemplate<T extends boolean>(
    file: File,
    opts: { dryRun: T; name?: string },
  ): Promise<T extends true ? TemplateImportPreview : ProjectSummary & { warnings: string[] }> {
    const form = new FormData();
    form.append("file", file, file.name);
    const q = new URLSearchParams(opts.dryRun ? { dryRun: "1" } : {});
    if (opts.name) q.set("name", opts.name);
    const res = await apiFetch(`/api/templates/import?${q}`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText, body.details);
    return body;
  },

  // ---- settings ----
  getMcpSettings: () => request<McpSettingsView>("GET", "/api/settings/mcp"),
  updateMcpSettings: (body: UpdateMcpSettingsBody) => request<McpSettingsView>("PUT", "/api/settings/mcp", body),

  // ---- user & comments ----
  getUser: () => request<UserProfile>("GET", "/api/user"),
  setUser: (profile: UserProfile) => request<UserProfile>("PUT", "/api/user", profile),
  getComments: (blockId: string, subBlockId: string) =>
    request<{ comments: Comment[] }>("GET", commentsUrl(blockId, subBlockId)).then((r) => r.comments),
  addComment: (blockId: string, subBlockId: string, text: string, anchor?: CommentAnchor | null) =>
    request<Comment>("POST", commentsUrl(blockId, subBlockId), anchor ? { text, anchor } : { text }),
  setCommentAnchor: (blockId: string, subBlockId: string, commentId: string, anchor: CommentAnchor | null) =>
    request<Comment>("PATCH", `${commentsUrl(blockId, subBlockId)}/${commentId}`, { anchor }),
  addReply: (blockId: string, subBlockId: string, commentId: string, text: string) =>
    request<CommentReply>("POST", `${commentsUrl(blockId, subBlockId)}/${commentId}/replies`, { text }),
  deleteComment: (blockId: string, subBlockId: string, commentId: string, replyId?: string) =>
    request<void>("DELETE", `${commentsUrl(blockId, subBlockId)}/${commentId}${replyId ? `/replies/${replyId}` : ""}`),
  /** Resolves (or, with resolved=false, reopens) a comment thread. */
  setCommentResolved: (blockId: string, subBlockId: string, commentId: string, resolved: boolean) =>
    request<Comment>("POST", `${commentsUrl(blockId, subBlockId)}/${commentId}/${resolved ? "resolve" : "reopen"}`, resolved ? {} : undefined),
  /** Every comment thread of the project, in document order. */
  getProjectComments: () => request<{ threads: ProjectCommentThread[] }>("GET", `${nbBase}/comments`).then((r) => r.threads),

  // ---- change notifications ----
  getNotifications: () => request<{ notifications: Notification[] }>("GET", `${nbBase}/notifications`).then((r) => r.notifications),
  markNotificationRead: (id: string) =>
    request<{ notifications: Notification[] }>("POST", `${nbBase}/notifications/${id}/read`).then((r) => r.notifications),
  markAllNotificationsRead: () =>
    request<{ notifications: Notification[] }>("POST", `${nbBase}/notifications/read-all`).then((r) => r.notifications),
  clearNotifications: () => request<void>("DELETE", `${nbBase}/notifications`),

  // ---- references ----
  getReferences: () => request<ReferenceNode>("GET", `${nbBase}/references`),
  createReferenceFolder: (path: string) => request<{ path: string }>("POST", `${nbBase}/references/folders`, { path }),
  renameReference: (path: string, newName: string) =>
    request<{ path: string }>("PATCH", `${nbBase}/references/rename`, { path, newName }),
  deleteReference: (path: string) => request<void>("DELETE", `${nbBase}/references?path=${encodeURIComponent(path)}`),
  // ---- images from references (image files, figures of documents) ----
  getReferenceImages: () => request<ReferenceImages>("GET", `${nbBase}/references/images`),
  /** Copies an image reference or figure into the block's assets (attaching the source to `attachTo`). */
  assetFromReference: (blockId: string, source: ReferenceImageSource, attachTo?: string) =>
    request<AssetFromReferenceResult>("POST", `${nbBase}/blocks/${blockId}/assets/from-reference`, { ...source, ...(attachTo ? { attachTo } : {}) }),
  /** A new image sub-block from an image reference or figure. */
  imageFromReference: (blockId: string, body: ReferenceImageSource & { caption?: string; alt?: string; title?: string; position?: number }) =>
    request<SubBlock>("POST", `${nbBase}/blocks/${blockId}/images/from-reference`, body),

  // ---- content for the assistant (Markdown conversions, page images) ----
  /** Converts files (folders expanded) now; `force` converts again even when up to date. */
  convertReferences: (paths: string[], force = false) =>
    request<{ results: (McpInfo & { path: string })[] }>("POST", `${nbBase}/references/mcp/convert`, { paths, force }),
  getMcpContent: (path: string) =>
    request<McpContent & { info: McpInfo }>("GET", `${nbBase}/references/mcp?path=${encodeURIComponent(path)}`),
  deleteMcpContent: (path: string) => request<void>("DELETE", `${nbBase}/references/mcp?path=${encodeURIComponent(path)}`),
  renderPageImages: (path: string, pages: "all" | number[]) =>
    request<{ manifest: McpManifest }>("POST", `${nbBase}/references/mcp/pages`, { path, pages }),

  /** Where a file (or the files of a folder) is associated or linked. */
  getReferenceUsages: (path: string) =>
    request<(Omit<BibUsage, "kind"> & { kind: BibUsage["kind"]; path: string })[]>("GET", `${nbBase}/references/usages?path=${encodeURIComponent(path)}`),
  /** Reference files associated with a whole section (`subBlockId` null) or sub-block. */
  setAttachedReferences: (blockId: string, subBlockId: string | null, paths: string[]) =>
    request<{ paths: string[] }>("PUT", `${nbBase}/blocks/${blockId}${subBlockId ? `/subblocks/${subBlockId}` : ""}/references`, { paths }),
  deleteReferences: (paths: string[]) => request<{ deleted: string[] }>("POST", `${nbBase}/references/delete`, { paths }),
  /** ZIP of files/folders, entries relative to `base`. Returns the archive and its suggested name. */
  async zipReferences(paths: string[], base: string): Promise<{ blob: Blob; name: string }> {
    const res = await apiFetch(`${nbBase}/references/zip`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths, base }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, err.error ?? res.statusText);
    }
    const disposition = res.headers.get("content-disposition") ?? "";
    const m = /filename\*=UTF-8''([^;]+)/.exec(disposition);
    return { blob: await res.blob(), name: m ? decodeURIComponent(m[1]) : "references.zip" };
  },
  async uploadReferences(dir: string, files: File[]): Promise<{ paths: string[] }> {
    const form = new FormData();
    files.forEach((f) => form.append("file", f, f.name));
    const res = await apiFetch(`${nbBase}/references/upload?dir=${encodeURIComponent(dir)}`, { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, err.error ?? res.statusText);
    }
    return res.json();
  },

  // ---- bibliography ----
  getBibliography: () => request<BibEntry[]>("GET", `${nbBase}/bibliography`),
  createBibEntry: (body: CreateBibEntryBody) => request<BibEntry>("POST", `${nbBase}/bibliography`, body),
  updateBibEntry: (key: string, body: UpdateBibEntryBody) =>
    request<BibEntry>("PATCH", `${nbBase}/bibliography/${encodeURIComponent(key)}`, body),
  /** 409 with `details.usages` when the entry is used, unless `force`. */
  deleteBibEntry: (key: string, force = false) =>
    request<{ removedAssociations: number }>("DELETE", `${nbBase}/bibliography/${encodeURIComponent(key)}?force=${force}`),
  getBibUsages: (key: string) => request<BibUsage[]>("GET", `${nbBase}/bibliography/${encodeURIComponent(key)}/usages`),
  importBibtex: (bibtex: string, onDuplicate: "skip" | "replace") =>
    request<ImportBibResult>("POST", `${nbBase}/bibliography/import`, { bibtex, onDuplicate }),
  async exportBibtex(): Promise<string> {
    const res = await apiFetch(`${nbBase}/bibliography.bib`);
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return res.text();
  },
  setSectionCitations: (blockId: string, keys: string[]) =>
    request<{ keys: string[] }>("PUT", `${nbBase}/blocks/${blockId}/citations`, { keys }),
  setSubBlockCitations: (blockId: string, subBlockId: string, keys: string[]) =>
    request<{ keys: string[] }>("PUT", `${nbBase}/blocks/${blockId}/subblocks/${subBlockId}/citations`, { keys }),

  async uploadAsset(blockId: string, file: File): Promise<UploadAssetResponse> {
    const form = new FormData();
    form.append("file", file);
    const res = await apiFetch(`${nbBase}/assets?blockId=${encodeURIComponent(blockId)}`, { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, err.error ?? res.statusText);
    }
    return res.json();
  },
};

/** URL of a file inside a block folder; stable across folder renumbering. */
export const blockFileUrl = (blockId: string, relPath: string) => `${nbBase}/blocks/${blockId}/files/${relPath}`;

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** URL serving a reference file (inline, or as a download). */
export const referenceUrl = (path: string, download = false) =>
  `${nbBase}/references/file/${encodePath(path)}${download ? "?download=1" : ""}`;

/** URL of a rendered page image of a converted reference (`v` busts the cache after re-rendering). */
export const mcpPageUrl = (path: string, n: number, v = "") => `${nbBase}/references/mcp/page?path=${encodeURIComponent(path)}&n=${n}${v ? `&v=${encodeURIComponent(v)}` : ""}`;

/** URL of a figure cut out of a converted PDF reference. */
export const mcpFigureUrl = (path: string, id: string, v = "") => `${nbBase}/references/mcp/figure?path=${encodeURIComponent(path)}&id=${id}${v ? `&v=${encodeURIComponent(v)}` : ""}`;

/** Link target for a reference from a Markdown sub-block (relative to blocks/NNN/subblocks/). */
export const referenceHrefFromSubBlock = (path: string) => `../../../references/${encodePath(path)}`;

/** Inverse of referenceHrefFromSubBlock: the reference path of a Markdown link, if it points to one. */
export function referencePathFromHref(href: string): string | null {
  const m = /^(?:\.\.\/)+references\/([^?#]+)/.exec(href);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}
