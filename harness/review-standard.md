---
harness_id: REV-STD-001
component: code review / PR quality
owner: Engineering
version: 0.4
status: active
last_reviewed: 2026-03-21
---

# Harness Standard — 代码审查规程

> **当前状态：active。** 完整 review 循环已定义：Pandas 触发 → Huahua 执行 → Claude Code 修复 → Daniel HITL 合并。
> review 的事实源是 GitHub PR，不在 `tasks/` 中重复维护状态机。

---

## Agent 角色边界

| 角色 | Review 职责 | 限制 |
|---|---|---|
| **Pandas**（orchestrator） | 在 Menglan 开 PR 后通知 Huahua 进行 review（via ATM inbox：`inbox_write_v2 → for-huahua/pending/`，type=request action=review） | **不读 PR diff，不发 review comments** — 避免上下文污染 |
| **Huahua**（review owner） | 执行 code review，输出 findings | 使用 CodeX + GH LLM Issue Orchestrator skill |
| **Menglan / claude_code**（implementer） | 实现功能、修复 review findings | 不做自己 PR 的 review |
| **Daniel**（HITL） | 最终合并决策 | 不做 code review — 只做合并拍板 |

---

## Review 触发流程

```
Menglan 开 PR
    └─▶ Pandas 检测到新 PR（轮询 gh pr list）
            └─▶ Pandas 通过 ATM inbox 通知 Huahua
                inbox_write_v2 → for-huahua/pending/（type=request action=review）
                payload 含：req_id, pr_number, objective, scope, expected_output, done_criteria
                └─▶ Huahua 使用 CodeX + GH LLM Issue Orchestrator
                        └─▶ Findings 输出为 PR review comments
                                └─▶ Pandas 检测 review 完成
                                        └─▶ 通知 Menglan：
                                            "Fix review findings: harness.sh fix-review N"
                                                └─▶ Daniel Telegram 通知：
                                                    "PR #N review complete, fixes pushed — merge?"
```

---

## PR 提交前自检（Menglan / claude_code）

- [ ] 本地测试全通过：`npm run release:audit && npm run build && npm test`
- [ ] `test_case_ref` 中所有 TC 对应测试通过
- [ ] 无遗留调试代码（`console.log` 临时调试）
- [ ] 无硬编码密钥、测试凭证或生产配置
- [ ] `tasks/features/REQ-xxx.md` 已更新为 `status: review`
- [ ] PR 处理（依路径二选一）：
  - 单PR规则路径（`EXISTING_BRANCH` 已设置）：`gh pr edit <number> --body '...'` 更新已有 PR（number 取自 `gh pr list --head feat/REQ-N --json number --jq '.[0].number'`）
  - 标准路径（无 `EXISTING_BRANCH`）：`gh pr create --fill` 创建新 PR（不留交互提示）

---

## Review 调用约束

执行 `Review PR#N` 时，以下约束优先于 reviewer 的默认行为：

1. **直出问题，不加冗余前缀**：输出只包含 findings，不附加总结、背景说明或肯定性语句。
2. **不设每次回复的问题数上限**：禁止以"先提 2~3 个问题"为由截断。在保持简洁表述的前提下，单次回复应尽量利用全部可用字符，将发现的问题一次性列出。
3. **从远端获取 PR 内容**：执行前必须 `gh pr checkout N` 或 `gh pr diff N`，不依赖本地分支状态。

---

## Review 关注点（Huahua）

Huahua 使用 **CodeX + GH LLM Issue Orchestrator** skill 执行 review，输出 findings 为 GitHub PR review comments。

**契约一致性**
- [ ] 实现与 REQ-xxx.md `Acceptance Criteria` 逐条对应
- [ ] TypeScript 类型正确，无 `any` 滥用
- [ ] API 路由与现有 UI 调用一致

**安全性**
- [ ] 无命令注入风险（execFile 参数验证）
- [ ] 无敏感数据写入日志或 HTTP 响应
- [ ] env 变量通过 `.env` 加载，不硬编码

**测试质量**
- [ ] 测试覆盖关键分支，不只是 happy path
- [ ] mock 策略符合 testing-standard.md §2.1

**代码可读性**
- [ ] 命名清晰，无缩写歧义
- [ ] 复杂逻辑有注释说明 why，而非 what

### Finding 分级

| 级别 | 标记 | 说明 |
|---|---|---|
| blocking | `[BLOCK]` | 必须修复才能合并（安全、逻辑错误、契约违反） |
| non-blocking | `[NIT]` / `[SUGGEST]` | 建议改进，不阻碍合并 |

---

## Fix Review Findings（Menglan / claude_code）

收到 Pandas 通知或 Daniel 指令后，执行：

```bash
./scripts/harness.sh fix-review <PR号>
```

harness.sh 会预注入所有 review comments，Claude Code 全量处理后回复每条 comment。

---

## HITL 合并条件（Daniel）

- [ ] CI 全部通过（release-audit + build + test + req-coverage）
- [ ] Huahua review 无 blocking comment（或 blocking comment 已由 claude_code 修复）
- [ ] PR merge 不允许自动化；Daniel 最终拍板（可通过 Telegram [Merge] 按钮触发）

---

## 变更日志

| 版本 | 日期 | 变更摘要 |
|---|---|---|
| 0.1 | 2026-03-15 | 初始 stub（从 hydro-om-copilot REV-STD-001 改写）；删去 openai_codex reviewer；改为 Daniel HITL；更新 pre-commit 命令为 TypeScript 栈 |
| 0.2 | 2026-03-15 | stub → active；新增 Pandas orchestrator 角色边界（不读 PR diff）；定义 Huahua review 触发流程（CodeX + GH LLM Issue Orchestrator）；新增 finding 分级（blocking/non-blocking）；明确 Telegram HITL 合并路径 |
| 0.3 | 2026-03-16 | 新增 §"Review 调用约束"：直出问题不加冗余前缀；不设单次回复问题数上限；执行前从远端拉取 PR 内容 |
| 0.4 | 2026-03-21 | 更新 Pandas 触发通道描述：从 "GitHub Issue / 任务队列" 改为 ATM inbox（inbox_write_v2 → for-huahua/pending/）；对齐 REQ-033–036 实际实现 |
