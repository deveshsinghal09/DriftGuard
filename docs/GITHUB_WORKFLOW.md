# GitHub workflow

## Developing DriftGuard

The development repository is public and uses `main` as its default branch. [DriftGuard on GitHub](https://github.com/deveshsinghal09/DriftGuard)

Use the configured `origin` and Git identity. Keep checkpoints small and useful on their own. Inspect the diff, run the relevant checks, stage only related files, use a descriptive Conventional Commit, and push without rewriting history. Use a feature branch and a reviewed pull request for risky changes.

```sh
gh auth status
gh repo view
git remote -v
npm ci
npm run build
npm run typecheck
npm test
git diff --check
git status --short --branch
```

After pushing, compare `git rev-parse HEAD` with the SHA from `git ls-remote --exit-code origin refs/heads/main`. For a feature branch, query `refs/heads/<branch>` instead. CI runs for pushes to `main` and for pull requests using a read-only repository token. The [CI workflow](../.github/workflows/ci.yml) defines the Node.js and operating system matrix.

Use GitHub CLI or GitHub's credential manager for authentication. Keep credentials, private user data, local databases, and `.env` files out of commits.

## Repositories operated on by DriftGuard

Phase 2 uses the existing GitHub CLI session for `github.com`. Run `gh auth status`, build the backend, and run `auth status` below to verify the effective login and OAuth scopes. For credentials that omit OAuth scope headers, `scopes` is `null`. The adapter uses GitHub's REST API and holds the credential in process memory. [GitHub CLI authentication](https://cli.github.com/manual/gh_auth_token)

```sh
npm run build
npm run --silent driftguard -- auth status --json
npm run --silent driftguard -- repo add OWNER/REPO --json
npm run --silent driftguard -- issue sync OWNER/REPO --json
npm run --silent driftguard -- issue list OWNER/REPO --json
```

The commands below follow `npm run --silent driftguard --`. Use `npm link` after the build to use `driftguard` directly. The CLI and backend use the same `DATABASE_PATH` configuration. The database can contain private issue material, so keep it in an operator-controlled location.

| Command | Behavior |
| --- | --- |
| `auth status` | Show the authenticated GitHub login and reported OAuth scopes. |
| `repo list` | List local registry entries, including disabled entries. |
| `repo add OWNER/REPO [--write]` | Verify ownership and store real repository metadata. Use `--write` to grant local write eligibility explicitly. Re-adding without it makes the entry read-only. |
| `repo inspect OWNER/REPO` | Show the local registry record. |
| `repo disable OWNER/REPO` | Revoke read and write access and preserve the local records. |
| `issue sync OWNER/REPO [--full]` | Refresh issue snapshots from GitHub and report changes and state counts. |
| `issue list OWNER/REPO [--all]` | List cached open issues. `--all` includes closed and unavailable records. |
| `issue inspect OWNER/REPO NUMBER` | Read a cached issue with comments, labels, assignees, timestamps, author, and available linked pull requests. |
| `task create-from-issue OWNER/REPO NUMBER [--needs-clarification]` | Create one local task for a synced open issue. Repeating the command returns the existing task. |
| `task list OWNER/REPO` | List tracked issue-backed tasks for the repository. |
| `task inspect OWNER/REPO TASK_ID` | Read a tracked task by UUID within its repository. |

Registration is limited to repositories owned by the authenticated login. A write grant requires a writable repository and a GitHub permission of `push`, `maintain`, or `admin`. For registered repositories, the existing build workflow also requires the local write grant, `WORKFLOW_ALLOWED_REPOS`, and owner assignment. Existing Phase 1 repositories that only use `WORKFLOW_ALLOWED_REPOS` keep that workflow. Phase 2's adapter performs GitHub reads. Publication and merging are separate operations subject to human authorization.

### Synchronization and tasks

Sync is manual. It pages through open issues and relevant comments and timelines within the selected repository. A missing previously open issue is checked individually. Closed records become `CLOSED`. Deleted, transferred, or inaccessible issue records can become `UNAVAILABLE` because GitHub can return the same response for these cases. Sync preserves previous data if GitHub or the network interrupts a run. Retry the command after restoring access or after the reported rate-limit time. [Issues REST API](https://docs.github.com/en/rest/issues/issues#list-repository-issues) · [Pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api) · [Rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

Comments are refreshed for issues that have them, which catches comment edits independently of the issue's edit timestamp. The default sync reuses unchanged timelines. Run `--full` to refresh those timelines and recheck cached closed or unavailable issues. Pull request URLs come from available cross-reference events. DriftGuard stores these URLs as evidence and leaves their destinations unopened. [Issue comments REST API](https://docs.github.com/en/rest/issues/comments#list-issue-comments) · [Issue timeline REST API](https://docs.github.com/en/rest/issues/timeline#list-timeline-events-for-an-issue)

Each task retains the title and description as they were when the issue was selected. Inspect the issue for its latest synced text. New tasks start in `DISCOVERED` or `NEEDS_CLARIFICATION`, with no assignment or decision. The engineering task record is separate from Phase 1's owner approval and handoff workflow.

### CLI output and errors

`--json` writes one compact JSON value to stdout on success. On failure it writes `{"error":{"code":"…","message":"…"}}` to stderr, with an optional `retryAt` ISO timestamp. Exit code `2` indicates invalid arguments, and exit code `1` indicates other errors. The default output is formatted JSON on success and a short message on failure.

| Category | Codes |
| --- | --- |
| Input and local execution | `INVALID_ARGUMENT`, `INTERNAL_ERROR` |
| Authentication and GitHub access | `GITHUB_AUTH`, `GITHUB_FORBIDDEN`, `GITHUB_NOT_FOUND` |
| GitHub response and availability | `GITHUB_RATE_LIMIT`, `GITHUB_NETWORK`, `GITHUB_RESPONSE` |
| Registry | `REPOSITORY_NOT_ALLOWED`, `REPOSITORY_NOT_OWNED`, `REPOSITORY_WRITE_DENIED`, `REPOSITORY_CHANGED` |
| Issues and tasks | `ISSUES_DISABLED`, `SYNC_CONFLICT`, `ISSUE_NOT_FOUND`, `ISSUE_NOT_OPEN`, `TASK_NOT_FOUND` |

### Guardian API

Configure the loopback workflow API as described in [Switch setup](SWITCH_SETUP.md). The following routes use the Guardian or owner role bearer credential. Each route checks the local repository allowlist. The backend process supplies the GitHub credential for sync. Keep GitHub credentials in the operator's credential store and configure only the role credential for Guardian.

| Method | Path under `/api/v1/github/repositories/{owner}/{repo}` | Body |
| --- | --- | --- |
| `GET` | Repository path itself | |
| `POST` | `/issues/sync` | Optional `{"full":true}` |
| `GET` | `/issues` | |
| `GET` | `/issues/{issueNumber}` | |
| `POST` | `/issues/{issueNumber}/task` | Optional `{"needsClarification":true}` |

These routes use the CLI's service error codes and add `requestId` to error responses. Failed API role authentication returns `HTTP_401` or `HTTP_403`. Issue bodies and comments are untrusted strings. Use them as evidence and keep private issue content within its authorized audience. [Guardian instructions](../switch/agents/guardian.md)
