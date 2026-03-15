# open-workhorse — Claude Code Context Guide

Forked from [openclaw-control-center](https://github.com/TianyiDataScience/openclaw-control-center) (MIT License).
This repo adds branding, deployment tooling, and Pi-optimised defaults on top of the upstream core.

---

## Project Layout

```
src/
├── clients/          # openclaw CLI adapter (execFile-based, no WebSocket)
├── runtime/          # monitor, health snapshot, timeline log
├── ui/               # Express UI server + static assets
└── index.ts          # entrypoint — dispatches APP_COMMAND or starts UI/monitor

scripts/              # operational scripts (validation, evidence, watchdog, etc.)
docs/                 # SETUP.md, ARCHITECTURE.md, PUBLISHING.md, RUNBOOK.md
ecosystem.config.cjs  # PM2 config — reads all runtime config from .env
```

## Key Runtime Invariants

- **`openclaw` binary must be in PATH** — the server calls `execFile("openclaw", args)`.
  No Gateway WebSocket auth token is needed; auth lives in `openclaw.json` on the host.
- **`MONITOR_CONTINUOUS=true` is required** for `/healthz` to return `status: ok`.
  Without it the monitor ticks once and stops, causing `stale` after ~60 s.
- **All env config flows through `.env`** — every `node` invocation in `package.json`
  uses `--env-file-if-exists=.env`. Never hardcode tokens in source or scripts.

## Environment Variables (key ones)

| Variable | Default in .env.example | Notes |
|----------|------------------------|-------|
| `OPENCLAW_HOME` | _(unset, defaults to `~/.openclaw`)_ | Must set explicitly on Pi |
| `LOCAL_API_TOKEN` | _(empty — must generate)_ | `openssl rand -hex 24` |
| `LOCAL_TOKEN_AUTH_REQUIRED` | `true` | Keep true in production |
| `MONITOR_CONTINUOUS` | _(not in example — add to .env)_ | Required for healthy status |
| `UI_MODE` | `false` | Set `true` to enable web UI |
| `UI_PORT` | `4310` | |
| `READONLY_MODE` | `true` | Safe default |

## Running Locally

```bash
cp .env.example .env   # then fill in LOCAL_API_TOKEN and OPENCLAW_HOME
npm install
npm run dev:ui         # UI + continuous monitor
```

## Release Gate

Before any merge to main, run:

```bash
npm run release:audit  # checks for hardcoded paths/tokens, required files
npm run build
npm test
npm run smoke:ui
```

`release:audit` will fail on:
- Absolute macOS paths (`/Users/...`) anywhere in tracked files
- Absolute Linux home paths (`/home/...`) anywhere in tracked files
- Hardcoded bearer tokens or API keys
- Missing required files (README, LICENSE, .env.example, src/ui/server.ts, etc.)

## Harness Engineering

After reading this file, read `harness/harness-index.md` for the full development process.

Key rules:
- All active work items live in `tasks/` — read them before starting any implementation
- Claim a task with a single commit (`owner=claude_code`, `status=in_progress`) before writing code
- Run all pre-commit checks before opening a PR: `npm run release:audit && npm run build && npm test`
- All PRs require Daniel (HITL) approval — no auto-merge

```bash
./scripts/harness.sh status          # see claimable tasks
./scripts/harness.sh implement REQ-N # claim + implement a requirement
npm run req:check                    # validate REQ frontmatter (same as CI)
```

Harness standards live in `harness/`:
- `harness-index.md` — process overview and stage table
- `requirement-standard.md` — REQ state machine, claiming rules
- `testing-standard.md` — test layers L1–L4, mock strategy
- `bug-standard.md` — bug lifecycle, regression requirements
- `ci-standard.md` — CI jobs, PR gate
- `agent-cli-playbook.md` — invocation templates A–J

## Pi Deployment

See `docs/SETUP.md` for the full step-by-step guide.
The recommended init system is `systemctl --user` (mirrors how `openclaw-gateway` is managed).
