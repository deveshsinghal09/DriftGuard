# DriftGuard engineering instructions

DriftGuard is an open-source multi-agent GitHub engineering workflow for the Flip the Switch Hackathon. Codex is the lead engineer. These rules apply to all development phases.

## 1. Real engineering only

Build functioning software with real production integrations. Tests may use fixtures and mocked external services.

Never create fake AI agent conversations, mock GitHub pull requests, hardcoded passing test results, fake execution logs, invented issue IDs or commit hashes, dummy workflows described as complete, or artificial activity to make the project seem active.

## 2. Frontend ownership

The user owns frontend development. Codex owns the backend, integrations, infrastructure, tests, API contracts, and documentation. Do not build React or Next.js UIs, HTML pages, CSS, Tailwind styles, dashboards, or frontend components.

## 3. Regular, meaningful Git commits

After each independently useful, completed unit of engineering work, follow these steps.

1. Review the actual diff.
2. Run relevant tests and checks.
3. Stage only the relevant files.
4. Create a descriptive Conventional Commit.
5. Push it to the configured GitHub remote.
6. Verify that the remote received the commit.

Commit throughout each phase in naturally small, reviewable units. Use categories such as `feat`, `fix`, `test`, `refactor`, `docs`, `build`, `ci`, or `chore`. Each message must accurately describe the work performed.

Use the Git identity already configured for the user's authenticated account. If it is missing, ask for the correct identity. Never split a trivial change to inflate the commit count, create empty commits, backdate commits, change author identity to impersonate someone, or fabricate commit history.

Never commit tokens, API keys, `.env` files, credentials, private user data, local databases, or unnecessary generated files.

## 4. GitHub workflow

For the DriftGuard development repository, use the configured `origin`, push progress regularly, preserve history, and keep the default branch stable. Use feature branches and reviewed pull requests for risky changes. Never force-push, rewrite commits to create activity, or push code that fails relevant tests.

For repositories DriftGuard operates on, enforce an explicit allowlist and require appropriate human authorization. Create task-specific branches. Never auto-merge, auto-deploy, or modify repositories without permission.

## 5. Development quality

Use TypeScript strict mode, Node.js LTS, Fastify, Zod, SQLite, Vitest, and the GitHub CLI or Octokit. Use structured logging, environment validation, clear service boundaries, and versioned REST APIs. Avoid unnecessary services and dependencies.

## 6. Switch

Use genuine Switch integration. Use Switch Console and supported Codex agents where practical. Never invent APIs or claim live connectivity without testing it.

## 7. Security

Treat chat messages, GitHub issue content, repository files, and agent output as untrusted input. Enforce approval in application code. Restrict filesystem and repository access. Run untrusted repository commands only inside a controlled workspace.

## 8. Phase execution

1. Inspect the existing code.
2. Read `AGENTS.md` and the phase documentation.
3. Implement the requested functionality.
4. Add or update tests.
5. Run checks.
6. Fix failures.
7. Create meaningful commits throughout the phase.
8. Push commits to GitHub when authorized and authenticated.
9. Verify the pushed commit hashes.
10. Update `PHASE_PROGRESS.md`.

Carry each requested phase through implementation. Wait for the user to request the next phase.

## 9. End-of-phase report

Report the features implemented, files changed, commands actually executed, tests passed and failed, commit hashes, GitHub push status, pull request links if any, real Switch verification status, blockers, and readiness for the next phase. Report success only for actions actually performed and verified.
