---
harness_id: CLI-PB-001
component: agent operations / CLI invocation
owner: Engineering
version: 0.1
status: active
last_reviewed: 2026-03-15
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

Steps:
1. Read tasks/features/REQ-<N>.md and all test_case_ref TC files before writing any code
2. Read the current Phase doc in tasks/phases/ to confirm iteration boundary
3. Claim: in your working branch, update REQ-<N>.md: owner=claude_code, status=in_progress, commit 'claim: REQ-<N>'
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
2. First commit: update tasks/bugs/BUG-<N>.md only — owner=claude_code, status=in_progress, commit 'claim: BUG-<N>'
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

## 人工触发 Agent Loop（tasks/ 有新任务时）

```bash
# 查看当前可认领任务
./scripts/harness.sh status

# 手动触发实现（claude_code）
./scripts/harness.sh implement REQ-<N>

# Bug 修复
./scripts/harness.sh bugfix BUG-<N>

# 修复 PR review comments（claude_code）
./scripts/harness.sh fix-review <PR号>
```

---

## 注意事项

| 场景 | 建议模式 |
|---|---|
| 实现 REQ | `claude -p`（由 harness.sh 调用）|
| Bug 修复 | `claude -p`（由 harness.sh 调用）|
| Fix review comments | `claude -p`（由 harness.sh 调用，预注入 comments）|
| 代码/文档一致性审查 | `claude -p`（模板 J）|
| 本地质量检查 | `claude -p`（模板 D）|

> **所有 PR 均需 Daniel（HITL）approve 后才能合并。**
> 不允许任何 PR 自动合入。

---

## 变更日志

| 版本 | 日期 | 变更摘要 |
|---|---|---|
| 0.1 | 2026-03-15 | 初始版本（从 hydro-om-copilot CLI-PB-001 v0.4 改写）；删去模板 E（TC 设计，Codex）、F（PR Review，Codex）、G/G-Promote（Bug 上报，Codex）、H（一致性审查，Codex）；保留 A/B/C/D/I；新增模板 J（代码/文档一致性审查，Claude Code 版）；删去 Stacked PR / Bundle 自动化 |
