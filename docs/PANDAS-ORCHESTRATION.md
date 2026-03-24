# PANDAS-ORCHESTRATION — Design Document

Pandas is the orchestration layer of the open-workhorse agent team.
It coordinates task dispatch, TC design, code review, and HITL escalation.

---

## §1 Overview

- **Pandas never reads PR diffs directly nor writes review comments.**
  Its job is coordination: claim tasks, route work to agents, gate merges, escalate decisions.
- Triggered by two sources:
  - (a) OpenClaw heartbeat — `APP_COMMAND=pandas-heartbeat`
  - (b) Telegram inbound from Daniel (text commands via `getUpdates`)
- All inter-agent communication is file-based (Shared Inbox — see §3).

---

## §2 State Machine

```
IDLE
  ├─ heartbeat tick: scan tasks/features/ for status=ready + owner=unassigned → auto-claim
  ├─ Telegram inbound "start REQ-N": claim specific REQ immediately
  └─ inbox/for-pandas/ message received: dispatch per message type

TASK_CLAIMED
  └─ req_check: validate REQ spec meets harness/requirement-standard.md
     ├─ invalid → Telegram Daniel:
     │            "REQ-N spec incomplete: <reason>. Fix before start? [Fix] [Skip]"
     └─ valid   → write inbox/for-huahua/: "TC design REQ-N"

TC_DESIGN  (Huahua working — 单PR规则 REQ-039)
  └─ Huahua 在 feat/REQ-N 分支创建 TC + 开 PR（不再使用独立 tc/ 分支）
     └─ harness.sh tc-review <PR>  ← Menglan reviews TCs
        ├─ findings → harness.sh fix-review <PR>  (up to 2 iterations total)
        └─ approved → tc_review 结果包含 branch_name=feat/REQ-N
                   → 该字段沿链传递：tc_review → tc_complete → implement
                   → write inbox/for-menglan/: implement REQ-N（含 branch_name）

DEV_ACTIVE  (Menglan implementing — 单PR规则 REQ-039)
  └─ harness.sh implement REQ-N（EXISTING_BRANCH=feat/REQ-N 时复用已有分支）
     └─ Menglan 更新现有 PR 描述（gh pr edit），不新建 PR
        └─ write inbox/for-huahua/: "code review PR #N REQ-N"

CODE_REVIEW  (Huahua reviewing)
  └─ harness.sh fix-review <PR>  ← Menglan fixes
     ├─ blocking findings → iterate (max 2 total)
     └─ no blocking findings
          → write inbox/for-pandas/: dev_complete REQ-N PR #N

PR_READY
  └─ Pandas reads inbox: dev_complete
     └─ tg_pr_ready <url> <summary> → Daniel: [Merge] [Hold]

MAJOR_DECISION  (interrupts any state — see §5)
  └─ Pandas detects trigger
     └─ tg_decision <context> <options> → Daniel replies
        └─ Pandas continues or pauses accordingly
```

---

## §3 IPC — Shared Inbox (FLOW.md convention)

**Root path:** `$SHARED_RESOURCES_ROOT/inbox/`

Default when `SHARED_RESOURCES_ROOT` is unset:
```
~/Dev/everything_openclaw/personas/shared-resources/inbox
```

Set `SHARED_RESOURCES_ROOT` in `.env` to override (required on Pi where home paths differ).

### Directory layout

```
inbox/
├── for-pandas/
├── for-huahua/
└── for-menglan/
```

### File naming convention

```
YYYY-MM-DD-{from}-{description}.md
```

Examples:
- `2026-03-16-menglan-dev-complete-REQ-020-PR-42.md`
- `2026-03-16-huahua-tc-done-REQ-020-PR-41.md`
- `2026-03-16-pandas-implement-REQ-021.md`

### Message body (YAML frontmatter)

```yaml
---
type: dev_complete | tc_complete | major_decision_needed | review_blocked | implement | tc_design | code_review
req_id: REQ-N
pr_number: 42          # optional — present for dev_complete / tc_complete / code_review
branch_name: feat/REQ-N  # optional — 单PR规则：tc_review→tc_complete→implement 链传递
summary: one-line description
status: success | blocked
blocking_reason: ""    # populated when status=blocked
---
```

Body (below frontmatter) is optional free-form context for the receiving agent.

### Processing rules

- `pandas-heartbeat.sh` scans `inbox/for-pandas/` at every heartbeat tick.
- Each file is processed once then **deleted** (consumed).
- `for-huahua/` and `for-menglan/` are written by Pandas and consumed by the respective agent.

---

## §4 Pandas Heartbeat Integration

OpenClaw calls `APP_COMMAND=pandas-heartbeat` on each heartbeat tick.
`src/index.ts` dispatches to `scripts/pandas-heartbeat.sh`.

### pandas-heartbeat.sh responsibilities (in order)

1. **Process inbox** — read all files in `inbox/for-pandas/`, handle each by `type`, delete after.
2. **Auto-claim** — if no active task, scan `tasks/features/` for `status=ready, owner=unassigned`
   with all `depends_on` satisfied; claim the highest-priority match.
3. **Stall detection** — apply same logic as `dev-cycle-watchdog.sh`; escalate via Telegram if stale.
4. **Keep-Alive Watchdog** (`_check_stall_and_keepalive`, REQ-039) — 每次心跳额外执行：
   - 扫描 `tasks/features/` 中 `status=in_progress` 的 REQ
   - 读取对应 agent 的存活时间戳（`runtime/menglan_alive.ts` / `runtime/huahua_alive.ts`）
   - 若文件缺失或距今 > `AGENT_STALL_TIMEOUT_MINUTES`（默认 60 分钟），向该 agent inbox 写
     keep-alive implement 消息（单PR路径时携带 `branch_name=feat/<REQ-N>`）
   - 不修改 REQ 状态；恢复由 agent 自主处理

### Auto-claim priority order

1. `status=test_designed` (TC already done, implementation ready)
2. `status=ready` with `tc_policy=exempt` or `tc_policy=optional`

Ties broken by `priority` field (P1 before P2 before P3).

---

## §5 Major Decision Triggers (initial list)

| Trigger ID | Condition | Detection method | Escalation message |
|------------|-----------|------------------|-------------------|
| TRIGGER-001 | External API key / credential dependency found in REQ body but absent from `.env.example` | Pandas scans REQ body for patterns: `API_KEY`, `SECRET`, `TOKEN`, `credential` | `tg_decision "REQ-N needs external credential X. Add to .env.example now? [Yes] [Defer]"` |
| TRIGGER-002 | Unidentified REQ dependency discovered during implementation | Menglan writes `major_decision_needed` to `inbox/for-pandas/` with `blocking_reason: depends_on REQ-M (unfinished)` | `tg_decision "REQ-N blocked by REQ-M. Prioritise REQ-M first? [Yes] [Descope]"` |
| TRIGGER-003 | Scope expansion | Menglan inbox: `blocking_reason: implementation requires changes outside REQ boundary` | `tg_decision "REQ-N scope expanded beyond spec. Approve expansion? [Approve] [Constrain]"` |

More triggers are added as encountered during operations. Each new trigger is documented here
and referenced in REQ-025 acceptance criteria.

---

## §6 Bidirectional Telegram

### Daniel → Pandas (text commands)

Parsed from Telegram `getUpdates` poll:

| Command | Action |
|---------|--------|
| `start REQ-N` | Claim and dispatch REQ-N immediately, bypassing auto-dispatch queue |
| `status` | Reply with current task states (active REQ, state, agent, iteration count) |
| `hold` | Pause auto-dispatch; Pandas enters manual-only mode |
| `resume` | Re-enable auto-dispatch after a `hold` |

Unrecognised messages are logged and ignored (no reply).

### Pandas → Daniel (outbound)

Uses `scripts/telegram.sh` functions:

| Function | When used |
|----------|-----------|
| `tg_notify` | Status updates, heartbeat anomalies, task transitions |
| `tg_decision` | Major decision escalations (see §5) — blocks until Daniel replies |
| `tg_pr_ready` | Dev PR is merge-ready — presents [Merge] [Hold] choice |

`tg_decision` blocks the orchestration loop; Pandas polls `getUpdates` until a matching
reply arrives or a timeout (default: 24 h) fires, at which point it escalates again.

---

## §7 TC Design Loop

TC loop: Huahua designs TCs, Menglan reviews them via `harness.sh tc-review`.

### Flow（单PR规则 REQ-039）

```
Pandas → inbox/for-huahua/: tc_design REQ-N
Huahua → 在 feat/REQ-N 分支创建 TC 文件并开 PR（不再使用独立 tc/REQ-N-<slug> 分支）
Pandas (or Daniel) → harness.sh tc-review <PR#>
  ├─ Findings: harness.sh fix-review <PR#>  (Huahua fixes, ≤ 2 iterations)
  └─ No findings / approved
       → tc_review 结果包含 branch_name: feat/REQ-N
       → 字段沿消息链传递：tc_review → tc_complete → implement
Pandas → inbox/for-menglan/: implement REQ-N（含 branch_name）
Menglan → harness.sh implement REQ-N（EXISTING_BRANCH=feat/REQ-N）
        → 复用已有分支，使用 gh pr edit 更新 PR 描述，不新建 PR
```

Maximum **2 review iterations** (initial review + 1 round of fixes).
If unresolved after 2 iterations, Pandas escalates via `tg_decision`.

> **tc_policy=exempt / optional 豁免**：无 TC 设计任务，`branch_name` 字段不存在，
> Menglan 走正常新建分支 + `gh pr create` 路径，与 REQ-039 前行为一致。

### harness.sh tc-review — prompt contract

The `tc-review` subcommand fetches the TC PR and injects this prompt to Menglan:

> Review TC coverage in PR #N against REQ-N acceptance criteria.
> For each TC, label it: **adequate** / **missing-branch** / **redundant**.
> Report findings only — do NOT modify TCs. Do not ask clarifying questions.
> If all TCs are adequate, conclude with: `tc-review: APPROVED`.

---

## §8 Code Review Loop

Code review loop: Huahua reviews the PR（单PR规则下即为 §7 中 Huahua 开的同一个 PR）。

```
Pandas → inbox/for-huahua/: code_review PR #N REQ-N
Huahua → posts review comments on PR #N
Menglan → harness.sh fix-review <PR#>  (fixes comments; on same feat/REQ-N branch)
  ├─ Blocking findings remain after 2 iterations → tg_decision
  └─ No blocking findings → Huahua approves PR
Huahua → writes inbox/for-pandas/: dev_complete REQ-N PR #N
Pandas → tg_pr_ready <url> <summary>
```

Maximum **2 fix iterations** (matching TC loop policy).

> 单PR规则下，Daniel 仅需 merge 一次（§7 中 Huahua 开的 feat/REQ-N PR）即完成整个 REQ 交付。

---

## §9 Configuration Reference

| Env var | Default | Purpose |
|---------|---------|---------|
| `SHARED_RESOURCES_ROOT` | `~/Dev/everything_openclaw/personas/shared-resources` | Root path for shared inbox |
| `TELEGRAM_BOT_TOKEN` | _(required for Telegram features)_ | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | _(required for Telegram features)_ | Daniel's chat ID |
| `DEV_WATCHDOG_STALE_HOURS` | `4` | Stall detection threshold（dev-cycle-watchdog.sh） |
| `AGENT_STALL_TIMEOUT_MINUTES` | `60` | Keep-alive watchdog 停滞阈值（分钟）；超过后向停滞 agent 发 keep-alive |
| `MENGLAN_WORKTREE_ROOT` | `~/workspace-menglan/open-workhorse/` | Menglan 的 git worktree 路径 |

---

## §10 Security Notes

- Inbox files are local filesystem only — no network exposure.
- `SHARED_RESOURCES_ROOT` must not point to a world-writable directory.
- Telegram `tg_decision` messages must not include raw API keys or tokens.
- All env vars flow through `.env` — never hardcoded in scripts.
