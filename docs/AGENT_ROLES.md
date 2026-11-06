# Agent roles and permissions

The human owner approves and assigns revisions through DriftGuard. Console instructions describe each agent's job. The workflow API independently verifies credentials, role permissions, repository allowlisting, and task state before recording a change.

| Principal | Permitted workflow actions | Credential boundary |
| --- | --- | --- |
| Human owner | Read workflow records and approve and assign an allowlisted proposal | Keep the owner API token outside agent workspaces. Retain control of human GitHub review and merge. |
| Guardian | Create and revise proposals, relay a recorded assignment, read the verification report | Guardian token only. Keep GitHub write credentials and writable target checkouts away from Guardian. |
| Builder | Confirm build access, submit the candidate SHA, send a verification handoff | Builder token only. For approved work, use a scoped GitHub credential limited to the authorized repository and operations. |
| Verifier | Read the assigned revision, check the exact candidate, and record its independent verdict | Verifier token only. Use an isolated checkout and read-only GitHub credentials. |

The workflow API rejects agent assignment attempts, wrong-role handoffs, missing Guardian dispatch, removed repositories, stale task references, and verification of a different candidate SHA. The Builder access response authorizes work inside DriftGuard. GitHub access must be provisioned separately. Keep the allowlist empty and leave GitHub writes unprovisioned for the role smoke test.

Switch access applies separately. Use a private room and the linked human owner. Keep Console's **Bypass permissions** off and **Can manage agents** off. **Me and my agents** permits the three owner-managed agents to address each other. Read and write visibility for the room restrict workspace access independently of who can address an agent. [Switch agent settings](https://docs.switchagents.ai/switch-rooms/getting-started/agent-settings) · [Identity and access](https://docs.switchagents.ai/switch-rooms/internals/identity-and-access)

Switch may run agents with access inherited from their host account. Use dedicated OS accounts or controlled runners before giving agents real repository work. Give each runner only its own workflow token, workspace, and approved GitHub grant. A separate directory under the same signed-in desktop account is useful for setup and can still share that account's tools and credentials. Keep the local smoke test limited to the three role questions and isolate credentials before introducing untrusted work. [Onboard agents](https://docs.switchagents.ai/switch-rooms/getting-started/onboard-your-agents) · [Working safely with agents](https://docs.switchagents.ai/switch-rooms/resources/working-safely-with-agents)

The standing instructions are in [Guardian](../switch/agents/guardian.md), [Builder](../switch/agents/builder.md), and [Verifier](../switch/agents/verifier.md). See [Switch setup](SWITCH_SETUP.md) to load them into Console.
