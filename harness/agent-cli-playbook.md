---
harness_id: CLI-PB-001
component: agent operations / CLI invocation
owner: Engineering
version: 0.4
status: active
last_reviewed: 2026-03-21
---

# Harness Playbook — Agent CLI 调用模板

> 本文件收录 Claude Code 的常用调用模板。
> 适用场景：人工触发 Agent 任务、调试 harness 流程、临时补跑单步阶段。
> 自动化触发（GitHub Action）见 ci-standard.md。

---

## Claude Code (`claude`)

### 基础用法

```bash
# 交互式（默认）
claude

# 非交互式，单次任务
claude -p "prompt"

# 跳过权限确认（harness.sh 场景）
claude --dangerously-skip-permissions -p "prompt"
```

---

### 模板 A · 启动新会话（Onboarding）

```bash
claude -p "
Read CLAUDE.md, then harness/harness-index.md.
Scan tasks/features/ for claimable tasks matching ALL of:
  - status=test_designed AND owner=unassigned
  - OR status=ready AND owner=unassigned AND tc_policy=optional or tc_policy=exempt
  - AND all depends_on entries are status=done (blocked tasks are NOT claimable)
Report what you find — do not claim anything yet.
"
```

---

### 模板 B · 认领并实现指定需求

```bash
claude -p "
Your task: implement REQ-<N>.

Working directory for all git and npm operations: ~/workspace-menglan/open-workhorse/
(harness.sh has already created this git worktree on branch feat/REQ-<N>)
Do NOT run git or npm commands from ~/workspace-pandas/open-workhorse/.

Steps:
1. Read tasks/features/REQ-<N>.md and all test_case_ref TC files before writing any code
2. Read the current Phase doc in tasks/phases/ to confirm iteration boundary
3. Claim: in your working branch, update REQ-<N>.md: owner=${AGENT_CODER}, status=in_progress, commit 'claim: REQ-<N>'
   (AGENT_CODER is read from .env, defaults to 'menglan'; see .env.example)
4. Write tests first (or confirm TC is runnable), then implement
5. Before opening PR: npm run release:audit && npm run build && npm test
6. Update REQ-<N>.md: status=review, fill Agent Notes
7. Open PR
"
```

---

### 模板 C · Bug 修复

```bash
claude -p "
Read harness/bug-standard.md.
Your task: fix BUG-<N>.

Steps:
1. Create branch: fix/BUG-<N>-<short-desc>
2. First commit: update tasks/bugs/BUG-<N>.md only — owner=${AGENT_CODER}, status=in_progress, commit 'claim: BUG-<N>'
   (AGENT_CODER is read from .env, defaults to 'menglan'; see .env.example)
3. Read tasks/bugs/BUG-<N>.md fully — reproduction steps, related_req, related_tc
4. Fix the bug + add regression test (node:test)
5. Final commit: set status=fixed, fill 根因分析 and 修复方案 in BUG-<N>.md
6. npm run release:audit && npm run build && npm test must pass
7. Open PR
"
```

---

### 模板 D · 本地质量检查（pre-PR）

```bash
claude -p "
Run all pre-commit checks defined in harness/ci-standard.md §Pre-commit:
  npm run release:audit
  npm run build
  npm test
Report any failures. Fix issues automatically where safe. Do not change logic without asking.
"
```

---

### 模板 I · Fix Review Comments（修复 PR review findings）

> 使用 `scripts/harness.sh fix-review <PR号>` 代替手动调用，脚本会预注入所有 review comments。

```bash
# review comments 由 harness.sh 预注入，无需 agent 自行探索
claude -p "
Read harness/review-standard.md.

## Pre-fetched context for PR #<N>
[由 harness.sh 自动填充 — review 顶层 comments + inline comments]

## Your task
Address every finding in both sections:
1. Read the referenced file+line for each inline comment
2. Fix the code or doc (do NOT skip any finding)
3. If a finding is invalid, note why — do not silently ignore
4. After all fixes are pushed:
   a) Inline comments (have id) → reply via (replace REPO with output of
      `gh repo view --json nameWithOwner -q .nameWithOwner`):
      gh api repos/REPO/pulls/<PR>/comments/<id>/replies -X POST -f body='Fixed in <sha>: <summary>'
   b) Top-level review summaries (no reply endpoint) → one general comment:
      gh pr review <PR> --comment -b 'Addressed review findings: ...'
Do NOT merge the PR — HITL merge only.
"
```

---

### 模板 K · Pandas 编排流程（Orchestrator Loop）

> Pandas 是 orchestrator/PM，负责轮询任务队列、协调 Menglan 实现与 Huahua review。
> **Pandas 不读 PR diff，不发 review comments** — 避免上下文污染。
> 允许的操作见 `harness/CAPABILITIES.md`；运行时绑定见 `harness/CONNECTORS.md`。

```bash
claude -p "
Read CLAUDE.md, harness/harness-index.md, harness/review-standard.md, and harness/CAPABILITIES.md.
You are Pandas — the orchestrator. Do not ask clarifying questions.

## Orchestration Loop (one iteration)

Step 0 — Check for-pandas/ inbox first:
  Ensure lifecycle dirs exist: source scripts/pandas-heartbeat.sh 2>/dev/null && inbox_init
  Read new result packets: ls \$SHARED_RESOURCES_ROOT/inbox/for-pandas/pending/
  If result packets present → process them via inbox_read_pandas() (route-result-decide_next_step) before scanning tasks.
  (inbox_read_pandas atomically mv pending→claimed before handling; do not manually process files)

Step 1 — Scan for claimable tasks:
  Run: ./scripts/harness.sh status
  If tasks available → trigger Menglan: ./scripts/harness.sh implement <REQ-N>
    (implement automatically creates a git worktree at ~/workspace-menglan/open-workhorse/
     on branch feat/<REQ-N>. Pandas stays on main in ~/workspace-pandas/open-workhorse/.)
  Wait for PR to be opened (poll: gh pr list --state open --json number,title --jq '.[] | .number')

Step 2 — Notify Huahua to review (ATM inbox):
  Once a new PR is detected, use inbox_write_v2 to send an ATM request to Huahua:
  source scripts/pandas-heartbeat.sh 2>/dev/null
  THREAD=\$(thread_get_or_create "<REQ-N>")
  CORR=\$(correlation_new "<REQ-N>")
  PAYLOAD=\$(mktemp)
  printf 'req_id: <REQ-N>\npr_number: <N>\nobjective: Review PR #<N> for <REQ-N> correctness and contract compliance\nscope: <REQ-N> implementation diff\nexpected_output: PR review comments with BLOCK/NIT classifications\ndone_criteria: All BLOCK findings addressed or PR approved\n' > "\$PAYLOAD"
  inbox_write_v2 "huahua" "request" "review" "\$THREAD" "\$CORR" "" "P1" "true" "\$PAYLOAD"
  rm -f "\$PAYLOAD"
  DO NOT read the PR diff yourself.

Step 3 — Wait for review completion:
  Poll: gh pr view <N> --json reviewDecision --jq '.reviewDecision'
  Also check for-pandas/ inbox for Huahua result packets.
  When reviewDecision != '' (or review result packet arrives) → review is complete.

Step 4 — Trigger fix-review if needed:
  If blocking review findings: ./scripts/harness.sh fix-review <N>
  Wait for fixes to be pushed.

Step 5 — Notify Daniel via Telegram:
  bash scripts/telegram.sh tg_pr_ready '<pr_url>' '<one-line summary>'
  Log result. Do NOT merge — HITL only.

Step 6 — After Daniel merges PR:
  Clean up Menglan worktree: ./scripts/harness.sh worktree-clean <REQ-N>

Loop back to Step 0.
"
```

---

### 模板 J · 代码/文档一致性审查（Claude Code）

```bash
claude -p "
Audit consistency between:
  - src/ (TypeScript source)
  - docs/ARCHITECTURE.md (architecture description)

Check for:
1. Functions/classes mentioned in ARCHITECTURE.md but missing or renamed in src/
2. New src/ modules not documented in ARCHITECTURE.md
3. Stale API route descriptions (routes in src/ui/ vs docs/)

Report mismatches. Do NOT modify frozen files or make code changes — report only.
"
```

---

## Runbook — 失败恢复指南

> **遇到命令失败时，先查 runbook，再动手修复。**
> runbook 收录了已知失败模式的根因与修复步骤，可节省重复排查时间。

```bash
# 列出所有 runbook 条目
./scripts/harness.sh runbook

# 按关键词搜索（如命令名、错误消息片段）
./scripts/harness.sh runbook "gh pr create"
./scripts/harness.sh runbook "interactive"
./scripts/harness.sh runbook "timeout"
```

### 贡献新 Runbook 条目

当遇到新失败并借助 LLM 修复时，执行：

1. 复制模板：`cp harness/runbook/_template.md harness/runbook/RB-NNN.md`
2. 填写：`trigger_command`、`symptom`、`root_cause`、`fix_steps`
3. 如有可重用修复脚本，填写 `new_tool` 字段
4. 提交至 main（文档变更，无需完整 CI 门禁）

---

## 人工触发 Agent Loop（tasks/ 有新任务时）

```bash
# 查看当前可认领任务
./scripts/harness.sh status

# 手动触发实现（Menglan / claude_code）
./scripts/harness.sh implement REQ-<N>

# Bug 修复
./scripts/harness.sh bugfix BUG-<N>

# 修复 PR review comments（claude_code）
./scripts/harness.sh fix-review <PR号>

# Runbook 查询（遇到失败时先查）
./scripts/harness.sh runbook [keyword]

# 开发周期停滞检测（dry-run）
DRY_RUN=true bash scripts/dev-cycle-watchdog.sh

# Telegram 测试
bash scripts/telegram.sh test
```

---

## 注意事项

| 场景 | 建议模式 |
|---|---|
| Pandas 编排循环 | `claude -p`（模板 K）|
| 实现 REQ（Menglan） | `claude -p`（由 harness.sh 调用）|
| Bug 修复 | `claude -p`（由 harness.sh 调用）|
| Fix review comments | `claude -p`（由 harness.sh 调用，预注入 comments）|
| 代码/文档一致性审查 | `claude -p`（模板 J）|
| 本地质量检查 | `claude -p`（模板 D）|
| 停滞检测 | `bash scripts/dev-cycle-watchdog.sh`（可 cron）|
| HITL 通知 | `bash scripts/telegram.sh`（需配置 bot token）|

> **所有 PR 均需 Daniel（HITL）approve 后才能合并。**
> 不允许任何 PR 自动合入。

---

### 模板 L · Memory Curation（Pandas 记忆整理）

> Pandas 在 session 结束或批量任务完成后将候选提升至 project.db。
> 完整架构见 `harness/memory-architecture.md`。

```bash
claude -p "
Read harness/memory-architecture.md.
Curate memory candidates from ~/workspace-pandas/memory/short-term/candidates/:
1. Read each .md file — topic, content, source_agent
2. Check for duplicates in project.db (mem-longterm-query_knowledge):
   sqlite3 \$MEMORY_DB_PATH 'SELECT topic FROM project_facts WHERE topic LIKE \"%<topic>%\"'
3. Accept: INSERT into project_facts or decisions or patterns table
   sqlite3 \$MEMORY_DB_PATH 'INSERT INTO project_facts (topic, content, source_agent) VALUES (...)'
4. Reject: note reason, update status field in the candidate file to 'rejected'
5. Move processed candidates to short-term/sessions/ with curation result appended
"
```

---

## 变更日志

| 版本 | 日期 | 变更摘要 |
|---|---|---|
| 0.1 | 2026-03-15 | 初始版本（从 hydro-om-copilot CLI-PB-001 v0.4 改写）；删去模板 E（TC 设计，Codex）、F（PR Review，Codex）、G/G-Promote（Bug 上报，Codex）、H（一致性审查，Codex）；保留 A/B/C/D/I；新增模板 J（代码/文档一致性审查，Claude Code 版）；删去 Stacked PR / Bundle 自动化 |
| 0.2 | 2026-03-15 | 新增模板 K（Pandas 编排流程）；新增 §Runbook 节（harness/runbook/ 查询与贡献）；人工触发部分补充 watchdog/telegram 命令；注意事项表新增 Pandas / 停滞检测 / HITL 通知行 |
| 0.3 | 2026-03-18 | 模板 K：替换 gh issue create 为 inbox file write（agent-inbox-write_review_packet）；Step 0 新增"先检查 for-pandas/ inbox"；新增 CAPABILITIES.md 引用；新增模板 L（Memory Curation）|
| 0.4 | 2026-03-21 | 模板 K 对齐 ATM REQ-034–036：Step 0 路径改为 pending/，加 inbox_init 前置；Step 2 payload 补全 4 个 delegation 必填字段（objective/scope/expected_output/done_criteria），thread/corr 生成改用 thread_get_or_create / correlation_new |
