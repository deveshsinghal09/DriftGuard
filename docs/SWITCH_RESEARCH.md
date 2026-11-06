# Switch Rooms research

Verified on 2026-11-06 against the published Switch AI documentation and its live documentation MCP endpoint. [Documentation home](https://docs.switchagents.ai/) · [Documentation index](https://docs.switchagents.ai/llms.txt)

## Documentation access

Both Codex CLI commands exited successfully. `codex mcp list` showed `switch-docs` enabled at `https://docs.switchagents.ai/mcp`. [OpenAI Docs for Codex MCP](https://developers.openai.com/codex/mcp) · [Switch documentation access](https://docs.switchagents.ai/use-these-docs)

```sh
codex mcp add switch-docs --url https://docs.switchagents.ai/mcp
codex mcp list
```

This running Codex chat reported `unknown MCP server 'switch-docs'` when asked for resources and resource templates. Start a fresh local Codex session or restart the desktop app to load the new registration into the tool inventory. A direct Streamable HTTP MCP probe separately negotiated MCP version `2025-03-26`, listed tools, and called `search_switch_ai`. The server returned the official **Set up agent providers** guide. The official Markdown pages also returned HTTP `200` directly. [Agent provider guide](https://docs.switchagents.ai/switch-rooms/getting-started/set-up-agent-providers)

## Console, rooms, and agents

- **Switch Console and Codex.** The desktop Console can run a Switch server or connect to an existing one. It starts an installed, signed-in Codex provider on the configured local or remote host, using the agent's working directory. Console can start a session when an addressed request arrives. The current Windows x64 Console build is documented as early access. [Install Console](https://docs.switchagents.ai/switch-rooms/getting-started/install-switch-console) · [Add a server](https://docs.switchagents.ai/switch-rooms/getting-started/add-a-server) · [Console runtime](https://docs.switchagents.ai/switch-rooms/internals/switch-console)
- **Agent creation.** From **Your Agents** in Console, add an agent with a server-unique name and description. Select its host, provider, and working directory, and add instructions if needed. Invite the registered agent to a room by name. For a custom wire client, registration uses a separate Gateway registration key and returns an agent key to keep securely across launches. [Onboard agents](https://docs.switchagents.ai/switch-rooms/getting-started/onboard-your-agents) · [Agent registration](https://docs.switchagents.ai/switch-rooms/internals/agent-protocol#register-the-agent)
- **Room configuration.** Create a room through Console or connect an existing messaging channel. Room settings cover participant membership, instructions, roles, and read and edit visibility. Restrict who can edit the DriftGuard room and invite only the people and agents needed for the workflow. [Create a room](https://docs.switchagents.ai/switch-rooms/getting-started/create-a-room) · [Manage rooms](https://docs.switchagents.ai/switch-rooms/administer/rooms)
- **Addressing and handoffs.** Humans can use `@agent-name` or a room alias. Roles can route work to the current holder. An agent can send a handoff using `send_targeted_message` or a mention in `post_message`. These are room messages carried by the Switch agent protocol. [Work in a room](https://docs.switchagents.ai/switch-rooms/using/work-in-a-room) · [Agent operations](https://docs.switchagents.ai/switch-rooms/internals/agent-protocol#operations)
- **Agent permissions.** Switch distinguishes who can address an agent, the room or resource permissions it inherits from its owner, and the provider's permission mode on the host. Keep **Bypass permissions** off and configure addressing explicitly. The onboarding and access pages describe a default that admits the owner and their agents, while the custom-client walkthrough warns of an owner-only registration default. Verify the effective policy on the installed server. DriftGuard GitHub writes require separate application authorization. [Agent settings](https://docs.switchagents.ai/switch-rooms/getting-started/agent-settings) · [Identity and access](https://docs.switchagents.ai/switch-rooms/internals/identity-and-access) · [Custom client walkthrough](https://docs.switchagents.ai/switch-rooms/internals/agent-protocol#writing-a-client)
- **Templates.** Switch documents room, agent, and group templates. A room template can capture room instructions, participants, aliases, roles, references, documents, and access settings. Named agents must already exist when a room template runs. Templates that create agents need a provider, host, and working directory. Console supports capturing a working room and editing or importing template YAML. [Room templates](https://docs.switchagents.ai/switch-rooms/administer/room-templates)

## Documented runtime protocol

The Switch Rooms bridge uses authenticated HTTP for operations and a WebSocket at `/agents/{agent_id}/connection/ws` for events. It requires a bearer agent API key. A custom client can discover operation names and schemas with `GET /agents/{agent_id}/ops`, then invoke them with `POST /agents/{agent_id}/ops/{operation}`. The protocol guide marks legacy SSE support as deprecated. [Agent protocol](https://docs.switchagents.ai/switch-rooms/internals/agent-protocol)

The connection uses a client-generated connection ID, a cursor, and a generation that fences reconnects. A client answers application pings with a pong and its cursor. It processes incoming room messages for work when `payload.addressed` is true. Clients may declare a supported revision range through `protocol` and `protocol_accepts`. The live server reports the negotiated revision in `connection_state`. [Agent connection](https://docs.switchagents.ai/switch-rooms/internals/agent-connection) · [Agent events](https://docs.switchagents.ai/switch-rooms/internals/agent-events)

The documentation MCP server serves reference material. A Console-managed agent uses a separate session-host MCP interface for tools, while the host talks to the Rooms bridge over HTTP and WebSocket. [Sessions and the runtime](https://docs.switchagents.ai/switch-rooms/internals/connectors-and-runtime)

## Verification boundary

Codex CLI reported a valid ChatGPT login. Phase 0 verified the documentation service and researched the runtime contract. A live Switch Console server, configured DriftGuard room, runtime protocol negotiation, and agent-to-agent handoff still require a Switch deployment and authorized room access.
