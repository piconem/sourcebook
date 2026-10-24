import { UsernameSchema, type AgentView, type Me, type Participant } from "@sourcebook/shared";
import { z } from "zod";
import { ApiError } from "../api.js";
import { READ, WRITE, projectParam, run, signature, type ToolContext } from "./common.js";

export function registerIdentityTool({ server, api, author, open, readOnly }: ToolContext) {
  server.registerTool(
    "whoami",
    {
      title: "Your agent identity",
      description:
        "Who you are in Sourcebook: the agent identity that signs your comments, notifications and locks (the one named by `agent`, or your user's default), the user you work for, and the other agents of that user.",
      inputSchema: {},
      annotations: READ,
    },
    run(async () => {
      const me = await api.json<Me>("GET", "/api/auth/me").catch((e) => (e instanceof ApiError ? null : Promise.reject(e)));
      // MCP has no web session: "session" means a Sourcebook without accounts (single user).
      if (!me || me.via === "session" || !me.via) return `You sign as ${signature(author)} — single-user Sourcebook.`;
      const agents = (await api.json<{ agents: AgentView[] }>("GET", "/api/agents")).agents.filter((a) => !a.revoked);
      const lines = [
        me.agent ? `You sign as ${signature(me.author)}.` : `You have no agent identity yet: register one with register_agent (or ${me.user.name} does it in Settings → My agents).`,
        `You work for ${me.user.name} (@${me.user.username}) and can do what they can.`,
      ];
      if (agents.length) {
        lines.push(
          `Agents of ${me.user.name}: ${agents.map((a) => `${a.name} (agent: "${a.id}")${a.default ? " — default" : ""}`).join(", ")}.`,
          'Pass agent: "<id>" to any tool to act as one of them (e.g. a writer and a reviewer sharing this connection); without it, the default one acts. Always use the same identity for the same role.',
        );
      }
      return lines.join("\n");
    }),
  );

  if (!readOnly) {
    server.registerTool(
      "register_agent",
      {
        title: "Register an agent identity",
        description:
          "Registers a new agent identity for the user you work for (e.g. id \"reviewer\", name \"Reviewer\"), so its comments and notifications are told apart from other agents'. Use it once per role, then pass agent: \"<id>\" to the tools. Ids and names already used by someone are refused. The user's first agent becomes their default.",
        inputSchema: {
          id: z.string().describe('Short handle: lower-case letters, digits, ".", "-", "_" (e.g. "reviewer")'),
          name: z.string().min(1).max(100).describe('Display name, e.g. "Reviewer"'),
        },
        annotations: WRITE,
      },
      run(async ({ id, name }) => {
        const clean = UsernameSchema.parse(id.trim().toLowerCase());
        const a = await api.json<AgentView>("POST", "/api/agents", { id: clean, name });
        return `Registered ${a.name} (agent: "${a.id}") for ${a.ownerName}${a.default ? " — it is their default agent" : ""}. Pass agent: "${a.id}" to act as it.`;
      }),
    );
  }

  server.registerTool(
    "list_participants",
    {
      title: "List the participants of a project",
      description:
        "The people and agents of a project: users who may open it and their agents, plus anyone who signed comments, replies, resolutions or notifications (id, name, who an agent works for, contributions, last activity).",
      inputSchema: { project: projectParam },
      annotations: READ,
    },
    run(async ({ project }) => {
      const nb = await open(project);
      const { participants } = await nb.api.json<{ participants: Participant[] }>("GET", `${nb.base}/participants`);
      const line = (p: Participant) =>
        `- ${p.name} — id "${p.username}" · ${p.local ? "local user (reserved)" : p.kind === "assistant" ? `agent${p.onBehalfOf ? ` of ${p.onBehalfOf.name}` : ""}` : "person"} · ${p.contributions} contribution(s)${p.lastActive ? `, last ${p.lastActive}` : ""}${p.username === author.username ? " · you" : ""}`;
      return [`${participants.length} participant(s) in ${project}:`, ...participants.map(line)].join("\n");
    }),
  );
}
