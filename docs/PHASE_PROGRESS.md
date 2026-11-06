# Phase progress

## Phase 0 — Backend foundation

Implemented the strict TypeScript project, Fastify server, environment validation, Pino logging, JSON errors, CORS allowlist, graceful shutdown, SQLite migrations, and `GET /api/v1/health`. Added npm scripts, 15 Vitest tests, a Windows and Linux CI matrix, and the requested repository layout and documentation.

### Environment and GitHub

- Windows 11 Home Single Language, x64, build 26300. The checkout was in the DriftGuard project directory.
- Node.js `22.14.0`, npm `10.9.2`, Git `2.48.1.windows.1`, GitHub CLI `2.95.0`, and Codex CLI `0.146.0`. Docker was absent from `PATH` and the standard Docker Desktop location. The backend runs without Docker.
- The GitHub account `deveshsinghal09` previously created the public DriftGuard repository and has admin access. Phase 0 reused the repository, updated its description, and verified authenticated pushes to `origin/main` by comparing commit hashes with `git ls-remote`. GitHub attributed the initial commit to the account using the configured Git identity. The CLI's current OAuth scope could not list private account emails. [DriftGuard on GitHub](https://github.com/deveshsinghal09/DriftGuard)

### Validation

| Check | Result |
| --- | --- |
| `npm install`, `npm ci`, `npm run build`, `npm run typecheck`, `npm test` | 15 tests passed locally across two files. |
| `npm start` and `Invoke-RestMethod http://127.0.0.1:3000/api/v1/health` | Returned `200` with `status: ok` and `checks.sqlite: ok`. Ctrl+C reached the shutdown handler, and the backend process and listener stopped. |
| SQLite and HTTP integration | Verified migration persistence across connections, `200` on a healthy database, `503` on an unavailable schema, CORS allowlisting, and JSON errors. |
| Initial GitHub Actions run | Three jobs passed. Windows Node 22 failed before tests when the `better-sqlite3` 13.x install invoked `node-gyp` and could not detect Visual Studio. [Initial CI run](https://github.com/deveshsinghal09/DriftGuard/actions/runs/42179470392) |
| Windows installation fix | Switched to `better-sqlite3` 12.11.1. All four CI jobs passed on Windows and Linux with Node 22 and 24. Its installer dependency `prebuild-install` emits a deprecation warning. [Upstream install issue](https://github.com/WiseLibs/better-sqlite3/issues/1516) · [Passing CI run](https://github.com/deveshsinghal09/DriftGuard/actions/runs/42179956651) |

Environment inspection used `Get-CimInstance`, `Get-Location`, `Get-Command`, and each installed tool's version command. Repository checks included `gh auth status`, `gh repo view`, `git status`, `git log --oneline`, `git remote -v`, and `git ls-remote`. Checkpoint diffs passed `git diff --cached --check` before commit.

### Switch verification and readiness

`codex mcp add switch-docs --url https://docs.switchagents.ai/mcp` and `codex mcp list` succeeded. A direct MCP handshake, tool listing, and `search_switch_ai` call succeeded, and the official documentation pages were read over HTTPS. The existing Codex chat requires a reload or fresh local session to expose the new tools. See [Switch research](SWITCH_RESEARCH.md) for the verified contract and sources.

Phase 0 delivers the backend baseline. Live room work requires a Switch server, an authorized room, and a configured Codex-backed agent. The next phase begins when requested.

## Phase 1 — Switch agents and handoffs

**Live engineering room verification is pending.** The local Switch 0.31.0 server started and returned HTTP 200 from `/health`. Switch Console 0.40.1 listed `driftguard-guardian`, `driftguard-builder`, and `driftguard-verifier` as running Codex-backed agents on this computer. The Switch controller confirmed all three agents attached to its event stream.

- Downloaded the official Windows x64 MSI, checked its SHA-256 against the GitHub release, verified the SandboxAQ Authenticode signature, and installed it with `msiexec`. Console found Codex signed in. [Switch Console release](https://github.com/sandbox-quantum/switch/releases/tag/switch-console-v0.40.1)
- `codex mcp get switch-docs` confirmed the registration. A direct MCP session listed tools and called `search_switch_ai` for server setup, Codex providers, agent instructions, addressing, identity, and templates. The running Codex chat still reported the server as unknown in its tool inventory.
- Created the three role profiles and the private `driftguard-engineering` template. The Switch server's bundled `lint_template` validator returned zero errors and warnings. The room was left uncreated because Console reported no connected messaging app.
- Sent the three role questions from [Switch setup](SWITCH_SETUP.md) as separate real Console direct messages. Switch queued each message for its intended agent. Each session failed to answer with `Provider request initialize timed out` from the Switch Codex app-server host. Standalone Codex JSON-RPC initialization succeeded from the same Windows account.
- Added loopback-only role authentication, SQLite task and handoff records, owner assignment, repository allowlisting, and candidate SHA verification. The API emits arguments for Switch's actual `send_targeted_message` tool. Tests cover invalid identities and references, cross-role denials, serialization, replay, and persistence across restart. [Agent protocol](AGENT_PROTOCOL.md) · [Role boundaries](AGENT_ROLES.md)

`npm run build`, `npm run typecheck`, and `npm test` passed locally with 39 tests. Checkpoints were reviewed with `git diff --cached --check` and verified on the pushed feature branch with `git ls-remote`.

Docker was unavailable, and automatic approval review rejected the Docker Desktop download-and-install command as blocked by policy. The native server came up without it. To finish the live check, bring up a supported Docker engine, connect Mattermost and link the owner's account, run the room template, and retry the Codex provider from Console. See [Switch setup](SWITCH_SETUP.md) for the three prompts and verification steps.

## Phase 2 — GitHub repositories, issues, and engineering tasks

- Added a GitHub CLI-authenticated REST adapter, an owned-repository allowlist with separate read and write grants, manual issue sync, and persistent issue-backed engineering tasks. Added the operator CLI and scoped loopback issue-review endpoints for Guardian. [GitHub workflow](GITHUB_WORKFLOW.md)
- Verified the effective GitHub login `deveshsinghal09` and OAuth scopes `gist`, `read:org`, `repo`, and `workflow`. Registered the public DriftGuard repository (ID `1447937430`) for read access. The local write flag is off. [DriftGuard on GitHub](https://github.com/deveshsinghal09/DriftGuard)
- `gh api` search found zero open issues owned by the account before validation. Filed the genuine missing owner-revocation feature through `gh issue create`, then synced it through the production adapter. The CLI returned one open issue (GitHub ID `6239128929`) and zero changed rows on repeat sync. [DriftGuard issue #2](https://github.com/deveshsinghal09/DriftGuard/issues/2)
- Created one `DISCOVERED` task from issue #2. Repeated task creation and separate CLI processes reopening SQLite returned the same task. The loopback Guardian API also synced and retrieved the issue and returned that task. Requests without credentials or with the Builder role were rejected.
- `npm ci`, `npm run build`, `npm run typecheck`, and `npm test` passed locally with 55 tests. Coverage includes authentication failure, repository scope, pagination, issue and comment edits, duplicate prevention, network recovery, untrusted text, and SQLite persistence. Used `git diff --cached --check`, `git push`, and `git ls-remote` to review and verify the checkpoints on `codex/phase-2-github`.

Issue sync is manual. The real GitHub and loopback API checks ran locally. Guardian's new issue-review instructions have not run in a live Switch room, where Phase 1's provider and room verification is still pending.
