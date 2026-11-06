# Set up the DriftGuard Switch room

## Local server and chat

1. Install and open Switch Console. On Windows, use the signed x64 installer. Choose **On this computer**, then **Start**. Wait for **Local server is running**. Console 0.40.1 on Windows can start its bundled Switch 0.31.0 and PostgreSQL directly. The setup screen skips bundled Mattermost when Docker is unavailable. [Install Switch Console](https://docs.switchagents.ai/switch-rooms/getting-started/install-switch-console) · [Switch Console 0.40.1 release](https://github.com/sandbox-quantum/switch/releases/tag/switch-console-v0.40.1)
2. For the Mattermost-backed room, start a supported Docker engine and confirm `docker info` succeeds. If the existing local server skipped Mattermost, restart Switch Console with Docker available on its process `PATH`. In Console, use **Home → Messaging apps** to confirm the bundled connection and linked user. If the connection requires sign-in, open **Sign-in details…**, then link the human's account with **Link → This is me**. The room owner must finish any account sign-in. [Bundled Mattermost troubleshooting](https://docs.switchagents.ai/switch-rooms/resources/troubleshooting#cant-reach-docker) · [Local server and account linking](https://docs.switchagents.ai/switch-rooms/getting-started/add-a-server)
3. On the agent host, run `codex --version` and `codex login status`. Confirm that the Console lists **Codex** as installed and signed in for that host. If Codex asks you to sign in or trust the chosen work directory, complete that step before retrying an addressed message. [Set up agent providers](https://docs.switchagents.ai/switch-rooms/getting-started/set-up-agent-providers)

## Register the three agents

Under **Your Agents**, select the add card. For each row below, use the exact name, select **Codex**, and select a separate work directory. Paste the corresponding file into **Agent instructions**. Alternatively, save its contents as `AGENTS.md` in the agent's dedicated Codex directory. A change to standing instructions applies on the next session. [Onboard agents](https://docs.switchagents.ai/switch-rooms/getting-started/onboard-your-agents) · [Change agent instructions](https://docs.switchagents.ai/switch-rooms/getting-started/agent-settings#change-what-the-agent-is-told)

| Name | Description | Role file |
| --- | --- | --- |
| `driftguard-guardian` | Detect conflicts and track decisions that need human clarification | [guardian.md](../switch/agents/guardian.md) |
| `driftguard-builder` | Implement assigned work and submit evidence for independent verification | [builder.md](../switch/agents/builder.md) |
| `driftguard-verifier` | Independently verify the exact candidate and report evidence | [verifier.md](../switch/agents/verifier.md) |

Use **Me and my agents** addressing for the human owner and the three same-owner agents. Keep **Bypass permissions** and **Can manage agents** off. Use the [credential boundaries](AGENT_ROLES.md) before exposing the agents to untrusted work.

## Create the room

1. In **Templates**, select **Import template** and load the [DriftGuard room template](../switch/templates/driftguard-engineering.template.yaml). Run it against the Mattermost connection or another supported messaging app already configured on the server. Its three named agents must already exist. The template creates a private room named `driftguard-engineering` and adds the linked creator and all three agents. [Switch templates](https://docs.switchagents.ai/switch-rooms/administer/room-templates) · [Release template schema](https://github.com/sandbox-quantum/switch/blob/switch-console-v0.40.1/docs/TEMPLATES.md)
2. If using **Your Rooms → Create a room** instead, select the messaging app and create a private room with the same name. Add the human owner and all three agents, set room read and write access to private, and paste the `room.instructions` text from the template into **Configuration → Instructions**. [Create a room](https://docs.switchagents.ai/switch-rooms/getting-started/create-a-room)

## Run the real message check

Send each line separately in the actual room as the human owner. Check that Switch addresses the named Codex session and the response comes from that agent. The role check uses an empty DriftGuard repository allowlist and no provisioned GitHub write grant.

```text
@driftguard-guardian What are your responsibilities?
@driftguard-builder What repository are you currently authorized to modify?
@driftguard-verifier What evidence is needed before you approve a code change?
```

Guardian should describe identifying conflicts, tracking decisions, and escalating to the owner. Builder should report the actual allowlist, or report the lack of an API connection and write grant. Verifier should identify the exact candidate SHA, approved requirements, and evidence from independent checks. Record the room name and the real message and reply references when available. Agent cards and room membership alone do not prove a Codex response. [Work in a room](https://docs.switchagents.ai/switch-rooms/using/work-in-a-room) · [When an agent doesn't answer](https://docs.switchagents.ai/switch-rooms/using/agent-not-answering)

Console direct chats can test provider startup before a messaging app is connected. Open an agent from the sidebar and choose **Direct chats → New chat**. If Console reports `Provider request initialize timed out`, verify that the CLI runs on that host, check **Settings → Agent providers**, and retry the session after confirming the provider is ready. Complete any Codex sign-in or workspace trust prompt yourself. A direct chat checks one agent. The collaborative acceptance test takes place in `driftguard-engineering` with the linked human and all three agents present. [Switch troubleshooting](https://docs.switchagents.ai/switch-rooms/resources/troubleshooting)

On Windows, if the Codex npm command wrapper times out during initialization, launch Console with the directory containing the installed native `codex.exe` first on its process `PATH`. If the account rejects the inherited model, select a model available to that account in each agent's **Advanced configuration → Model**. [Switch agent model settings](https://docs.switchagents.ai/switch-rooms/getting-started/agent-settings#change-the-model-or-tools)

## Enable the DriftGuard workflow API

On the DriftGuard host, set `HOST=127.0.0.1` and supply four separately generated `WORKFLOW_*_TOKEN` values in the local environment or ignored `.env`. Keep each token with its intended principal. For live authorized engineering work, set `WORKFLOW_ALLOWED_REPOS` to an explicit comma-separated list of GitHub `owner/repo` names. Keep it empty for a role smoke test.

Run `npm install`, `npm run build`, and `npm start`. Verify `GET /api/v1/agents/me` with each scoped role credential. Connect the isolated agent runners to that local API as appropriate. Switch is the room and handoff transport, and its tools carry the authenticated local workflow records between agents. [Handoff protocol](AGENT_PROTOCOL.md)
