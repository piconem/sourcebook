import type { Participant } from "@sourcebook/shared";
import { READ, projectParam, run, type ToolContext } from "./common.js";

export function registerIdentityTool({ server, author, open }: ToolContext) {
  server.registerTool(
    "whoami",
    {
      title: "Your agent identity",
      description:
        "The identity (id and name) that signs your comments and notifications on this connection, and how to use another one when several agents work on the same project.",
      inputSchema: {},
      annotations: READ,
    },
    run(async () =>
      [
        `You sign as ${author.name} (id "${author.username}").`,
        "When several agents work with the user on the same project, each must sign with its own identity: pass agent {id, name} to add_comment, reply_to_comment, resolve_comment, notify_changes, request_reload and save_reference_transcription (always the same values), or configure this connection with SOURCEBOOK_MCP_AGENT_ID / SOURCEBOOK_MCP_AGENT_NAME (stdio) or ?agent_id=…&agent_name=… on the /mcp URL (HTTP).",
        "Before choosing an identity, call list_participants: an id already used with another name, a name already used by another id, or the local user's username are refused.",
      ].join("\n"),
    ),
  );

  server.registerTool(
    "list_participants",
    {
      title: "List the participants of a project",
      description:
        "Who has signed comments, replies, resolutions or notifications in a project (people and agents: id, name, contributions, last activity), plus the local user. Check it before choosing your agent identity: ids and names already taken by someone else are refused; reusing your own id with the same name is fine.",
      inputSchema: { project: projectParam },
      annotations: READ,
    },
    run(async ({ project }) => {
      const nb = await open(project);
      const { participants } = await nb.api.json<{ participants: Participant[] }>("GET", `${nb.base}/participants`);
      const line = (p: Participant) =>
        `- ${p.name} — id "${p.username}" · ${p.local ? "local user (reserved)" : p.kind === "assistant" ? "agent" : "person"} · ${p.contributions} contribution(s)${p.lastActive ? `, last ${p.lastActive}` : ""}${p.username === author.username ? " · this connection's identity" : ""}`;
      return [`${participants.length} participant(s) in ${project}:`, ...participants.map(line)].join("\n");
    }),
  );
}
