# DriftGuard handoffs in Switch

Switch is the engineering conversation and handoff channel. DriftGuard's local SQLite database holds the authoritative task, human assignment, revision, candidate SHA, and verification record. The published Switch agent protocol describes addressed messages over WebSocket and authenticated HTTP operations. It documents no native task or decision API for this workflow. [Switch agent protocol](https://docs.switchagents.ai/switch-rooms/internals/agent-protocol)

## Task lifecycle

1. Guardian records a proposal with the repository, requirements or conflict summary, and source references. DriftGuard issues a task UUID, a decision UUID, and revision 1.
2. The authenticated human owner approves and assigns the exact revision using the assignment route. The repository must be on the configured allowlist.
3. Guardian records `request_build` and sends it to Builder in `driftguard-engineering`. Builder confirms the recorded handoff and checks build access for the exact repository and revision.
4. Builder records `request_verification` with the full candidate SHA and sends it to Verifier. Verifier retrieves the record, checks the same commit in an independent checkout, and runs applicable tests.
5. Verifier records `report_verification` with `verified` or `changes_requested` and sends it to Guardian. Only the human reviews and merges a pull request.
6. Guardian can revise a proposal or a task with changes requested. The task and decision IDs stay the same, the revision increases, and the new revision requires fresh assignment and dispatch. Prior handoff records remain readable by their original participants.

## Local API

Enable the workflow with the four distinct `WORKFLOW_*_TOKEN` settings in the environment example. The API binds to loopback and uses `Authorization: Bearer <role token>`. The server derives the actor from the credential. The repository allowlist defaults to empty. [Role and credential boundaries](AGENT_ROLES.md)

| Route under `/api/v1` | Actor | Input |
| --- | --- | --- |
| `GET /agents/me` | Any authenticated role | Returns authenticated identity and the repository allowlist visible to that role. |
| `POST /tasks` | Guardian | `repository` as `owner/repo`, `summary`, and `evidenceReferences` |
| `GET /tasks/{taskId}` | Any authenticated role | Task UUID in the path |
| `POST /tasks/{taskId}/revise` | Guardian | Current `decisionId` and `revision`, plus a replacement `proposal` with the same fields as task creation |
| `POST /tasks/{taskId}/assign` | Human owner | Current `decisionId` and `revision` |
| `POST /tasks/{taskId}/build-access` | Builder | Current `decisionId`, `revision`, exact `repository`, and Guardian's dispatch `correlationId` |
| `POST /handoffs` | Source agent for the action | `taskId`, `decisionId`, `revision`, `action`, `correlationId`, `evidenceReferences`. Add `candidateSha` for verification actions and `verdict` for the report. |
| `GET /handoffs/{correlationId}` | Source, target, or human owner | Correlation UUID in the path |

## Envelope and delivery

The API returns `envelope` and `switchArguments`. The envelope contains `taskId`, `decisionId`, `revision`, `sourceAgent`, `targetAgent`, `action`, `status`, `evidenceReferences`, `correlationId`, and a server-stamped UTC `timestamp`. Verification actions also carry `candidateSha`. Evidence references are short links or stable IDs that point to actual messages, changes, or checks.

| Action | Source → Target | Status |
| --- | --- | --- |
| `request_build` | Guardian → Builder | `assigned` |
| `request_verification` | Builder → Verifier | `ready_for_verification` |
| `report_verification` | Verifier → Guardian | `verified` or `changes_requested` |

The sender passes `switchArguments` directly to the Console-managed session's `send_targeted_message` tool. `body` is serialized JSON and `target_names` contains the intended Switch agent name. The tool adds the address itself. Keep the message in the engineering room. A recipient compares the envelope with the stored receipt and current task before acting. Switch carries the request, while the API checks the identity, assignment, and candidate. [Addressing in a room](https://docs.switchagents.ai/switch-rooms/using/work-in-a-room) · [Agent operations](https://docs.switchagents.ai/switch-rooms/internals/agent-protocol#operations)

Reuse the same correlation UUID and request body for a retry of the same handoff. DriftGuard returns the original envelope and timestamp. A changed payload with the same UUID, a repeated action with a different UUID, a stale revision, or a candidate mismatch returns `409`. A missing task returns `404`, malformed input `400`, missing or invalid authentication `401`, and denied role or repository scope `403`.

A persisted receipt records an authorized handoff payload. Confirm delivery in Switch through the actual message and addressed reply. If a send times out, inspect room context for its correlation ID before retrying so the room does not receive duplicate posts.
