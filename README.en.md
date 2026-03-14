# open-workhorse

> **"The Chosen Ones"** — AI team management system for the OpenClaw backend.

Language: **English** | [中文](README.md)

---

```
They don't take days off. They don't call in sick. They don't slack.
They are The Chosen Ones.
Your only job is to watch them work.
```

---

## What this is

`open-workhorse` is a local control center built for the [OpenClaw](https://github.com/TianyiDataScience/openclaw-control-center) backend.

Your AI Agent Team is running in the background — Lion synthesizes, Otter briefs you at 7:30, Pandas dispatches code, Monkey ships content. They were chosen. They don't rest. But you need to know what they are doing, whether they are stuck, and what they are spending.

That's why `open-workhorse` exists.

**Forked from** [openclaw-control-center](https://github.com/TianyiDataScience/openclaw-control-center) (MIT License, by [@TianyiDataScience](https://github.com/TianyiDataScience)). Thanks to the original author for the solid foundation and the open invitation to make it your own.

---

## What you get

| Section | One line |
|---------|----------|
| **Overview** | Is everything okay? Who's busy, who's stuck, what needs a decision |
| **Staff** | Who is actually running tasks versus just queued |
| **Tasks** | Task board + approval queue + execution chain evidence |
| **Usage** | What burned today, trend, quota remaining |
| **Documents & Memory** | Read and write agent working docs and long-term memory source files directly |
| **Settings** | Which data sources are wired, which high-risk actions are intentionally off |

---

## Safe by default

You can delegate to The Chosen Ones. You shouldn't lose control of them.

- `READONLY_MODE=true` — read-only by default
- `LOCAL_TOKEN_AUTH_REQUIRED=true` — local token auth by default
- `APPROVAL_ACTIONS_ENABLED=false` — approval actions disabled by default
- `IMPORT_MUTATION_ENABLED=false` — import mutations disabled by default

You can observe everything. Nothing changes without your explicit sign-off.

---

## 5-minute start

```bash
npm install
cp .env.example .env
npm run build
npm test
npm run smoke:ui
UI_MODE=true npm run dev
```

Then open:
- `http://127.0.0.1:4310/?section=overview&lang=en`
- `http://127.0.0.1:4310/?section=overview&lang=zh`

---

## Onboarding: let your own OpenClaw handle it

The fastest path is to hand the install instruction to your own OpenClaw and let it do the wiring.
Standalone file: [INSTALL_PROMPT.en.md](INSTALL_PROMPT.en.md).

<details>
<summary>Expand install prompt</summary>

```text
You are installing and connecting OpenClaw Control Center to this machine's OpenClaw environment.

Your goal is not to explain theory. Your goal is to complete a safe first-run setup end to end.

Hard rules:
1. Work only inside the control-center repository.
2. Do not modify application source code unless I explicitly ask.
3. Do not modify OpenClaw's own config files.
4. Do not enable live import or approval mutations.
5. Keep all high-risk write paths disabled.
6. Do not assume default agent names, default paths, or a default subscription model. Use real inspection results from this machine.
7. Do not treat missing subscription data, missing Codex data, or a missing billing snapshot as an install failure. If the UI can run safely, continue and clearly mark which panels will be degraded.
8. Do not fabricate, generate, or overwrite any provider API key, token, cookie, or external credential. If OpenClaw itself is missing those prerequisites, report the gap instead of guessing.

Follow this order: inspect environment → install dependencies → apply safe defaults → build/test/smoke → hand off a ready-to-run result.

Format your final answer as:
- Environment check
- Differences and degradation assessment
- Actual changes
- Verification result
- Next command
- First pages to open
```

</details>

---

## Manual `.env` configuration

```dotenv
GATEWAY_URL=ws://127.0.0.1:18789
READONLY_MODE=true
APPROVAL_ACTIONS_ENABLED=false
APPROVAL_ACTIONS_DRY_RUN=true
IMPORT_MUTATION_ENABLED=false
IMPORT_MUTATION_DRY_RUN=false
LOCAL_TOKEN_AUTH_REQUIRED=true
UI_MODE=false
UI_PORT=4310

# Only set these when your paths differ from the defaults:
# OPENCLAW_HOME=/path/to/.openclaw
# CODEX_HOME=/path/to/.codex
# OPENCLAW_SUBSCRIPTION_SNAPSHOT_PATH=/path/to/subscription.json
```

---

## Local commands

```bash
npm run build
npm run dev
npm run dev:ui          # UI only
npm run dev:continuous  # continuous monitoring mode
npm run smoke:ui        # quick smoke check
npm test
npm run validate
npm run command:backup-export
npm run release:audit   # pre-publish audit (maintainers only)
```

---

## HTTP endpoints (common subset)

```
GET  /snapshot                          raw snapshot JSON
GET  /api/projects                      project list
GET  /api/tasks                         task list
GET  /api/sessions                      session list
GET  /api/usage-cost                    usage and spend snapshot
GET  /api/action-queue                  pending action queue
GET  /api/approvals/:id                 approval detail
GET  /digest/latest                     latest digest HTML
GET  /healthz                           system health
GET  /api/replay/index                  replay index
POST /api/approvals/:id/approve|reject  approval action (gated + dry-run)
POST /api/import/live                   live import (high-risk, off by default)
```

Full endpoint reference: `GET /api/docs`.

---

## Runtime files

```
runtime/
├── last-snapshot.json
├── timeline.log
├── projects.json
├── tasks.json
├── budgets.json
├── digests/YYYY-MM-DD.md      ← consumed by Lion and Otter
├── doc-hub-chat.json          ← structured chat document index
├── export-snapshots/
└── exports/
```

---

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
- [`docs/PROGRESS.md`](docs/PROGRESS.md)

---

## Credits

`open-workhorse` is forked from [TianyiDataScience/openclaw-control-center](https://github.com/TianyiDataScience/openclaw-control-center) (MIT License).
Thanks to the original author for building a solid foundation and for the open invitation to make it your own.

---

*The Chosen Ones are always on shift.*
