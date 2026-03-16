---
harness_id: BUG-STD-001
component: bugs / defect tracking
owner: Engineering
version: 0.1
status: active
last_reviewed: 2026-03-15
---

# Harness Standard — Bug 管理与回归规程

> 本规范定义 open-workhorse 在 Harness Engineering 范式下的 Bug 记录方式、
> 状态机、严重等级、Claude Code 认领与回归测试要求。
> 默认 Bug 协作走 GitHub；仅当缺陷需要长期跟踪或进入 Claude Code 自动修复队列时，才提升为 repo 内 Bug 工作项。

---

## 1. 适用范围

- **组件**：Bug 报告、根因定位、回归测试、关闭口径
- **输入类型**：测试失败输出、人工发现缺陷、CI 失败
- **触发时机**：
  - [ ] 测试用例运行失败时
  - [ ] 人工测试发现与预期不符的行为时
  - [ ] PR review 中发现已合并代码存在缺陷时

### 1.1 事实源边界

| 场景 | 默认事实源 |
|---|---|
| PR review 中发现的问题 | GitHub PR comment / review |
| CI 失败或临时缺陷协作 | GitHub issue / PR |
| 需要长期跟踪、与 REQ/TC 建强关联、或进入 Claude Code 自动修复队列 | `tasks/bugs/BUG-xxx.md` |

---

## 2. Bug 与需求的关系

| 场景 | 处理方式 |
|---|---|
| 已有 REQ，实现与验收标准不符 | 开 Bug，关联 `related_req`；REQ 状态不变 |
| REQ 验收标准本身写错导致 Bug | 开 Bug，同时更新 REQ 的 `Acceptance Criteria` 和对应 TC |
| 没有对应 REQ 的缺陷（技术债/框架问题）| 开 Bug，`related_req: []` |
| Bug 修复需要引入新功能 | Bug 关闭后单独开 REQ，不在 Bug 内扩展 |

### 2.1 tc_policy 回填规则（逐步还账）

当 Bug 的 `related_req` 中存在**没有 `tc_policy` 字段、或 `tc_policy: optional`** 的 REQ 时，
开 BUG 文档的同时必须在该 REQ 的 frontmatter 中补写：

```yaml
tc_policy: required
```

**目的**：确保对旧 REQ 的首次缺陷修复触发"测试先行"门禁，实现逐步还账而非永久豁免。

**执行时机**：开 BUG 文档时即写入，不得推迟到 PR 提交时。

**例外**：若该 REQ 的缺陷属于 `S4`（纯体验问题），且评估后 TC 投入不具性价比，可在 REQ 上写 `tc_policy: exempt` 并在 `tc_exempt_reason` 中注明理由。

### 2.2 Bug → REQ Blocking 规范（多 Agent 路径）

当 Bug 开立时，若 `related_req` 非空：

| 步骤 | 操作 |
|---|---|
| 1 | 在每个关联 REQ 的 `Agent Notes` 末尾追加 Bug 外链，格式：`BUG-xxx: <一句话摘要>` |
| 2 | 将关联 REQ 的 `status` 更新为 `blocked`，`blocked_reason: bug_linked` |
| 3 | 将关联 REQ 的 `owner` 清空为 `unassigned`（等待 Bug 修复后重新认领）|
| 4 | commit message：`bug-block: REQ-xxx blocked by BUG-xxx` |

**Agent Notes 追加格式：**

```
## Bug 外链
- BUG-xxx: <一句话摘要>（status: open / confirmed / ...）
```

**目的**：确保 REQ 负责 Agent 和 Pandas Orchestrator 均能感知阻塞来源，避免 review → done 时遗漏 Bug。

### 2.3 Bug Clean → REQ Unblock 规范

当 Bug 关闭（`status → closed`）时：

| 步骤 | 操作 |
|---|---|
| 1 | 检查 `related_req` 中所有 REQ 的 `Agent Notes`，找到引用本 Bug 的外链 |
| 2 | 更新该外链状态标注：`BUG-xxx: <摘要>（status: closed）` |
| 3 | 若该 REQ 的 Agent Notes 中**无其他未关闭 Bug**（`status != done/closed`），则将 REQ `status` 从 `blocked` 改回上次状态（通常为 `in_progress` 或 `review`）|
| 4 | 将 `blocked_reason` 清空或移除 |
| 5 | commit message：`bug-unblock: REQ-xxx unblocked, BUG-xxx closed` |

**判断条件**：REQ Agent Notes 中所有 `BUG-xxx` 外链的 status 均为 `closed` 或 `done` → REQ 可离开 `blocked`。

---

## 3. 目录与文档规范

> 本节仅适用于 Bug 被提升为 repo 内工作项时。

### 3.1 目录位置

```text
tasks/bugs/BUG-xxx.md       # 活跃 Bug
tasks/archive/done/         # 已关闭 Bug
tasks/archive/cancelled/    # 已标记 wont_fix 的 Bug
```

### 3.2 Bug 文档必须包含的字段

| 字段 | 说明 |
|---|---|
| `bug_id` | 唯一编号，例如 `BUG-001` |
| `title` | 简洁标题，动词开头 |
| `status` | 只能使用本规范状态机 |
| `severity` | `S1` / `S2` / `S3` / `S4`（见 §4） |
| `priority` | `P0` / `P1` / `P2` / `P3` |
| `owner` | `unassigned` / `pandas` / `huahua` / `menglan` / `claude_code` / `human` |
| `related_req` | 关联需求编号列表，无则空数组 |
| `related_tc` | 触发此 Bug 的测试用例，或回归时需新增的 TC |
| `tc_policy` | `required` / `optional` / `exempt`；缺省视为 `optional` |
| `tc_exempt_reason` | `tc_policy=exempt` 时必填；说明豁免理由 |
| `reported_by` | `human` / `ci` / Claude Code 标识 |
| `depends_on` | （可选）必须先合并的 REQ/BUG 编号列表 |

### 3.3 Bug 文档推荐结构

```md
---
bug_id: BUG-001
title: [动词开头的简洁标题]
status: open
severity: S2
priority: P1
owner: unassigned
related_req: []
related_tc: []
tc_policy: required
tc_exempt_reason: ""
reported_by: human
depends_on: []
---

# 现象描述
> 实际发生了什么，在什么操作路径下触发

# 预期行为
> 按需求/验收标准，应该发生什么

# 复现步骤
1.
2.
3.

# 环境信息
- 分支：
- 相关 commit：

# 根因分析
> 修复者填写；定位到具体文件/函数/逻辑

# 修复方案
> 修复者填写；说明改动范围

# 回归测试
> 对应 TC 编号，或新增 TC 的描述；必须在 PR 中通过

# Agent Notes
```

---

## 4. 严重等级

| 等级 | 含义 | 典型示例（open-workhorse）|
|---|---|---|
| `S1` | 系统不可用或核心功能完全失效 | UI 服务器启动失败；/healthz 永不返回；openclaw 调用 500 |
| `S2` | 主要功能损坏，有明显错误结果 | 健康快照数据丢失字段；会话列表解析错误 |
| `S3` | 次要功能异常，有替代路径 | UI 页面布局错位；非关键字段格式错误 |
| `S4` | 体验问题，不影响功能 | 文案错别字；日志冗余；颜色偏差 |

### 4.1 严重等级与优先级的关系

严重等级描述**影响范围**，优先级描述**处理顺序**。两者独立。

---

## 5. 状态机

### 5.1 允许状态

| 状态 | 含义 |
|---|---|
| `open` | Bug 已记录，等待确认 |
| `confirmed` | 已确认可复现，等待认领修复 |
| `in_progress` | 已被 Claude Code 认领并执行修复中 |
| `fixed` | 修复代码已提交 PR |
| `regressing` | PR 合并后正在运行回归测试 |
| `closed` | 回归测试通过，Bug 已关闭 |
| `wont_fix` | 明确决策不修复（需注明原因）|

### 5.2 合法流转

```
open → confirmed → in_progress → fixed → regressing → closed
         ↓               ↓
      wont_fix      wont_fix（开发中发现不值得修）
                         ↓
                    open（修复方案不可行，重新评估）
```

### 5.3 非法流转

- 不允许 `open → closed`（必须经过 confirmed 和回归）
- 不允许 `fixed → closed`（必须经过 `regressing`）
- 不允许 PR 中无回归 TC 而将状态推进到 `fixed`
- 不允许 `tc_policy=required` 且 `related_tc` 为空时推进到 `in_progress`

---

## 6. Claude Code 认领规程

### 6.1 认领前检查

- [ ] `status == confirmed`
- [ ] `owner == unassigned`
- [ ] `depends_on` 中所有项已 `done`

### 6.2 认领动作（单 commit）

单 Agent 模式，无需 Claim PR 互斥锁：

| 步骤 | 操作 |
|---|---|
| 1 | 创建 fix 分支：`fix/BUG-xxx-<short-desc>` |
| 2 | 第一个 commit 只改 `tasks/bugs/BUG-xxx.md`：`owner → claude_code`，`status → in_progress` |
| 3 | commit message：`claim: BUG-xxx` |
| 4 | 继续在同一分支实现修复 |

### 6.3 修复完成要求

PR 必须同时包含：

- [ ] Bug 修复代码
- [ ] 回归测试用例（新增或更新 TC 文档，写入 `related_tc`）
- [ ] `BUG-xxx.md` 状态更新为 `fixed`，填写"根因分析"和"修复方案"

### 6.4 放弃与释放

- 把 `status` 改回 `confirmed`
- 清空 `owner`
- 在 `Agent Notes` 中说明原因

---

## 7. 回归测试要求

### 7.1 最低要求

每个 Bug 修复 PR **必须包含至少一个能复现并验证修复的测试**：

| Bug 层级 | 回归测试类型 |
|---|---|
| runtime 逻辑 / 状态机 | node:test 单元测试（L1）|
| UI / HTTP 行为 | node:test + HTTP 请求 mock |
| CLI 适配器行为 | node:test + execFile mock |

### 7.2 禁止事项

- 禁止在没有新增或更新测试的情况下关闭 Bug
- 禁止用"手工验证了"替代自动化回归测试（S4 Bug 除外，可豁免）

---

## 8. 关闭口径

| 状态 | 关闭条件 |
|---|---|
| `closed` | 回归测试在 CI 中全通过；`related_tc` 非空；`根因分析` 已填写 |
| `wont_fix` | 已写明不修复原因；若为设计如此，应更新 REQ 的 Acceptance Criteria |

---

## 9. 审查清单

### 自动可检查（脚本 / CI）

- [ ] Bug frontmatter 字段完整
- [ ] `status` 只使用允许枚举值
- [ ] `severity` 只使用 `S1/S2/S3/S4`
- [ ] `priority` 只使用 `P0/P1/P2/P3`
- [ ] `status == fixed` 时 `related_tc` 非空
- [ ] `status == in_progress` 时 `owner != unassigned`
- [ ] `tc_policy` ∈ `{required, optional, exempt}`（字段存在时）
- [ ] `tc_policy=exempt` 时 `tc_exempt_reason` 非空

### 人工检查

- [ ] 复现步骤明确，另一个人能独立复现
- [ ] 根因分析定位到具体代码位置
- [ ] 回归 TC 能精准覆盖 Bug 场景，而非泛化测试
- [ ] `wont_fix` 有充分理由，相关 REQ / TC 已同步更新

---

## 10. 变更日志

| 版本 | 日期 | 变更摘要 |
|---|---|---|
| 0.1 | 2026-03-15 | 初始版本（从 hydro-om-copilot BUG-STD-001 v0.8 改写）；删去 LLM Canary 触发条件；owner 枚举改为 unassigned/claude_code/human；认领改为单 commit（无 Claim PR 互斥锁）；回归测试改为 node:test |
| 0.2 | 2026-03-16 | 多 Agent 扩展（REQ-027）：owner 扩展加入 pandas/huahua/menglan；新增 §2.2 Bug→REQ blocking 规范；新增 §2.3 Bug clean→REQ unblock 规范 |
