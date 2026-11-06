# DriftGuard

An AI engineering team that catches conflicting requirements and ships verified GitHub pull requests through Switch. Phase 0 provides the backend and documents the planned Switch and GitHub workflow.

## Run the backend

Use Node.js 22 LTS (22.12 or later) or Node.js 24 LTS and npm. Use the latest patch available for your Node.js release line. [Node.js release schedule](https://nodejs.org/en/about/previous-releases)

```sh
npm install
npm run build
npm start
```

With the defaults, the health endpoint is `http://127.0.0.1:3000/api/v1/health`.

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health
```

The API returns `200` when the SQLite migration history reports the current schema version. A failed SQLite check returns `503` with the same JSON error envelope used elsewhere in the API. Errors contain `error.code`, `error.message`, and `error.requestId`.

Copy `.env.example` to `.env` to override defaults. Process environment variables take precedence over the file.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP bind address |
| `PORT` | `3000` | HTTP port from 1 to 65535 |
| `LOG_LEVEL` | `info` | Pino log level |
| `DATABASE_PATH` | `.driftguard/driftguard.sqlite` | SQLite file path relative to the working directory, or an absolute path |
| `CORS_ORIGINS` | Empty | Comma-separated browser origins such as `http://localhost:5173`. Empty disables CORS. |

The server applies SQLite migrations before it starts listening. Stop it with Ctrl+C so Fastify can drain requests and close SQLite.

## Check changes

```sh
npm run typecheck
npm test
```

The integration tests start Fastify on an ephemeral loopback port and use a temporary SQLite database. GitHub Actions runs the build, type check, and tests on Windows and Linux with Node.js 22 and 24.

## Project docs

- [Architecture](docs/ARCHITECTURE.md)
- [Switch research](docs/SWITCH_RESEARCH.md)
- [GitHub workflow](docs/GITHUB_WORKFLOW.md)
- [Phase progress](docs/PHASE_PROGRESS.md)
