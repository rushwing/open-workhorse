---
harness_id: REQ-STD-001
component: requirements / task routing
owner: Engineering
version: 0.4
status: active
last_reviewed: 2026-03-17
---

# Harness Standard — 需求管理与任务认领规程

> 本规范定义 open-workhorse 在 Harness Engineering 范式下的需求记录方式、
> 状态机、优先级、Phase 管理，以及 Claude Code 认领规则。
> 目标是让 Claude Code 能在 repo 内规范下读取开发输入、
> 判断可认领任务、执行开发，并把需求状态回写到统一位置。

---

## 1. 适用范围

- **组件**：需求文档、任务拆分、Agent 认领规则、状态回写规则
- **输入类型**：Phase 文档、需求项文档、阻塞说明、验收标准、认领信息
- **触发时机**：
  - [ ] 新增功能需求时
  - [ ] 拆分实现任务时
  - [ ] Claude Code 启动开发前
  - [ ] 任务状态变化时
  - [ ] PR 合并或需求关闭时

---

## 2. 设计原则

### 2.1 Repo 内需求是 Claude Code 可执行层的事实源

| 项目 | 内容 |
|---|---|
| 规则 | 与代码实现直接相关、需要 Claude Code 读取并执行的需求，必须记录在 repo 内 |
| 目的 | 让 Claude Code 在本地即可获得稳定上下文，不依赖聊天记录或外部项目管理工具 |
| 好示例 | 某个监控快照、UI 路由、健康检查逻辑写入 `tasks/features/` |
| 坏示例 | 关键验收条件只存在于聊天里，repo 内无对应需求项 |

### 2.2 `tasks/` 只承载开发输入，不重复建模 GitHub 协作对象

| 项目 | 内容 |
|---|---|
| 规则 | `tasks/` 默认只承载 REQ、TC，以及少量需要长期跟踪的 repo 内 Bug；PR、review、merge 默认以 GitHub 为事实源 |
| 目的 | 避免在 repo 与 GitHub 之间维护两套并行状态 |
| 好示例 | `tasks/features/REQ-001.md` 记录需求，PR reviewer / reviewDecision / merge 状态直接看 GitHub |
| 坏示例 | 在 repo 中再维护一份"review 已认领 / review 通过"，同时 GitHub 上还有 reviewer 和 review 状态 |

### 2.3 需求文档应短小、结构化、可认领

| 项目 | 内容 |
|---|---|
| 规则 | 每个需求项文档只描述一个可交付任务单元，必须包含明确验收标准 |
| 目的 | 降低 Claude Code 理解偏差，方便自动判断"是否可开始/是否完成" |
| 好示例 | "修复健康检查 stale 逻辑"单独成项，含验收条件 |
| 坏示例 | 一个文档同时混写 10 个目标、多个阶段和大量开放讨论 |

### 2.4 状态必须简单、可迁移

| 项目 | 内容 |
|---|---|
| 规则 | 只使用本规范定义的 9 个状态；禁止自行扩展近义状态 |
| 目的 | 避免状态语义漂移 |
| 好示例 | `draft -> review_ready -> req_review -> ready -> test_designed -> in_progress -> review -> done` |
| 坏示例 | `doing`、`wip`、`almost_done`、`ready-for-next-pass` 混用 |

---

## 3. 目录规范

### 3.1 目录结构

```text
tasks/                  # 所有待执行工作项的根目录
  phases/               # Phase 定义文档 (PHASE-xxx)
  features/             # 功能需求项 (REQ-xxx)
  bugs/                 # 可选：长期跟踪的 repo 内 Bug (BUG-xxx，见 harness/bug-standard.md)
  test-cases/           # 测试用例设计 (TC-xxx，先于实现创建)
  archive/
    done/               # 已完成归档
    cancelled/          # 已废弃归档
```

### 3.2 目录职责

| 目录 | ID 前缀 | 职责 |
|---|---|---|
| `tasks/phases/` | `PHASE-xxx` | 记录阶段目标、范围、入口/退出条件 |
| `tasks/features/` | `REQ-xxx` | 当前活跃的功能需求项 |
| `tasks/bugs/` | `BUG-xxx` | 可选：长期跟踪、需要 Agent 自动挑选修复的 Bug |
| `tasks/test-cases/` | `TC-xxx` | 测试用例设计文档，先于实现创建 |
| `tasks/archive/done/` | — | 已完成的 REQ / BUG / TC |
| `tasks/archive/cancelled/` | — | 已废弃的 REQ / BUG / TC |

---

## 4. Phase 规范

### 4.1 Phase 文档用途

| 项目 | 内容 |
|---|---|
| 规则 | 每个 Phase 必须定义阶段目标、阶段范围、阶段外内容、入口条件和退出条件 |
| 目的 | 让 Claude Code 在认领具体任务前知道当前迭代边界 |

### 4.2 Phase 最低字段

- `phase_id`
- `title`
- `status`
- `goal`
- `in_scope`
- `out_of_scope`
- `exit_criteria`

---

## 5. 需求项规范

### 5.1 每个需求项必须包含的字段

| 字段 | 说明 |
|---|---|
| `req_id` | 唯一编号，例如 `REQ-001` |
| `title` | 简洁标题 |
| `status` | 只能使用本规范状态机 |
| `priority` | `P0` / `P1` / `P2` / `P3` |
| `phase` | 所属 Phase，例如 `phase-1` |
| `owner` | `unassigned` / `pandas` / `huahua` / `menglan` / `claude_code` / `human`（具名 agent 值由 .env `AGENT_*` 变量配置，此处为默认值）|
| `blocked_reason` | 仅 `status=blocked` 时填写；枚举见 §6.5 |
| `blocked_from_status` | 仅 `status=blocked` 时填写；记录进入 blocked 前的状态，供 unblock 时恢复用 |
| `blocked_from_owner` | 仅 `blocked_reason=bug_linked` 时填写；记录 block 前的 owner，供 unblock 时恢复用（见 bug-standard.md §2.2/§2.3）|
| `review_round` | （可选）当前打回轮次，整数；超过 2 轮时升级 Daniel |
| `depends_on` | 顺序依赖项列表（所有项必须 `done` 才可认领），无则空数组 |
| `test_case_ref` | 对应测试用例文档列表，例如 `[TC-001, TC-002]`；`test_designed` 状态必须非空 |
| `tc_policy` | `required` / `optional` / `exempt`；缺省视为 `optional` |
| `tc_exempt_reason` | `tc_policy=exempt` 时必填；说明豁免理由 |
| `scope` | `runtime` / `ui` / `tests` / `scripts` / `docs` |
| `acceptance` | 验收标准摘要（一句话）|
| `pending_bugs` | （可选）关联中的未关闭 Bug 编号列表，例如 `[BUG-003]`；空数组 `[]` 为正常态；非空时为 Menglan 路由信号（见 bug-standard.md §2.5）；由 bug-standard.md §2.2 blocking 步骤写入，§2.3 unblock 步骤清除 |

### 5.2 推荐文档结构

```md
---
req_id: REQ-001
title: [标题]
status: draft
priority: P1
phase: phase-1
owner: unassigned
blocked_reason: ""
blocked_from_status: ""
blocked_from_owner: ""
depends_on: []
test_case_ref: []
tc_policy: required
tc_exempt_reason: ""
scope: runtime
acceptance: [一句话摘要]
pending_bugs: []
---

# Goal

# In Scope

# Out of Scope

# Acceptance Criteria

# Test Case Design Notes
> 描述需要覆盖的场景，供测试用例设计参考。此节不是测试用例本身，测试用例独立存在于 test-cases/。

# Agent Notes

# 关联 Bug 历史
> Bug 修复关闭后由 bug-standard.md §2.3 unblock 步骤自动追加，按 bug_type 分类；历史永久保留，不随 pending_bugs 清空而删除。
```

### 5.3 一项需求只定义一个完成口径

| 项目 | 内容 |
|---|---|
| 规则 | 一个需求项必须只有一个"完成"判定，不得同时包含多个彼此独立的终点 |
| 目的 | 避免 Claude Code 做了一半就误判为完成 |
| 好示例 | "健康检查接口返回 ok 且测试更新完成" |
| 坏示例 | "修 runtime、修 UI、补 5 个 unrelated 测试、重设计配置" 全塞一项 |

---

## 6. 状态机

### 6.1 允许状态

| 状态 | 含义 |
|---|---|
| `draft` | 需求还在整理，不能认领 |
| `review_ready` | Human-to-Pipeline 交接点；Daniel 设置，Pandas 扫描并原子 commit 转为 `req_review`（state-as-lock，防重复认领） |
| `req_review` | Pandas 已 claim，Huahua 做需求评审（验收标准、范围确认）；评审通过后进入 `ready` |
| `ready` | 需求评审已通过；Huahua 自持 owner，继续 TC 设计（`tc_policy=required`）；TC 设计完成后直接写 Menglan inbox，不回弹 Pandas 心跳；`tc_policy=optional/exempt` 时同理直接写 Menglan inbox 实现认领 |
| `test_designed` | 对应 TC 文档已创建并填入 `test_case_ref`，可被 Claude Code 认领实现 |
| `in_progress` | 已被 Claude Code 认领并执行中 |
| `blocked` | 由于依赖未完成、review 打回或关联 Bug 未关闭而暂停；原因写入 `blocked_reason` 字段及 `Agent Notes` |
| `review` | 实现已完成，PR 已提，等待 review / 验收 |
| `done` | 已合并或已确认完成 |

### 6.2 合法流转

```
draft → review_ready → req_review → ready → test_designed → in_progress → review → done
         (Daniel)       (Pandas          ↓           ↓            ↓            ↓
                        state-as-     blocked ←→ ready/test_designed ←──────────┘
                        lock)         (blocked_reason 必须填写)
```

折叠路径（Huahua 同步完成 TC 设计，跳过 ready）：
```
req_review ──────────────────────────→ test_designed
```

当 `tc_policy=optional` 或 `tc_policy=exempt` 时：
```
draft → review_ready → req_review → ready → in_progress → review → done
```

- `draft → review_ready`：Daniel 确认需求初稿，手动设置此状态；Pandas 心跳扫描到后原子 commit 转为 `req_review` 并设 `owner=huahua`
- `review_ready → req_review`：仅由 Pandas 单 commit 完成（state-as-lock），防止并发重复认领；不允许人工直接跳过
- `req_review → ready`：Huahua 评审通过，需求范围、验收标准已确认，且 `check-req-coverage.sh` frontmatter 检查通过
- `req_review → blocked`：Huahua 在评审中发现需求缺陷，开 `req_bug` 并 block REQ
- `ready → test_designed`：TC 文档已创建，`test_case_ref` 非空
- `test_designed → in_progress`：Agent 认领（单 commit 改 owner + status）
- `ready → in_progress`：仅当 `tc_policy=optional` 或 `tc_policy=exempt`
- `in_progress → review`：实现完成，PR 已提
- `X → blocked`：任意状态进入 blocked 时，必须同时写入 `blocked_reason`（枚举见 §6.5）和 `blocked_from_status: X`；若 `blocked_reason=bug_linked`，还须写入 `blocked_from_owner: <当前 owner>` 并将 `owner` 清空为 `unassigned`（见 bug-standard.md §2.2）；`review` 打回时额外在 Agent Notes 追加打回原因及关联 Bug 外链（若有）
- `blocked → X`：unblock 时将 `status` 恢复为 `blocked_from_status`；若 `blocked_from_owner` 非空，同时将 `owner` 恢复为 `blocked_from_owner`；清空 `blocked_reason`、`blocked_from_status`、`blocked_from_owner`；`review_round` 递增（若因 review 打回导致的 block）
- `review → done`：PR 合并；`pending_bugs` 必须为空数组（即所有关联 Bug `status=closed`）——Bug clean 门控；`pending_bugs` 非空则不允许 merge

### 6.3 非法流转

- 不允许 `draft → req_review`（必须先经过 `review_ready`；Pandas 不可直接 claim `draft` 状态的需求）
- 不允许 `draft → ready`（必须先经过 `review_ready → req_review`）
- 不允许 `draft → done`
- 不允许 `blocked → done`（必须先 unblock，经 `in_progress → review → done`）
- 不允许 `tc_policy=required` 时 `ready → in_progress`（必须经过 `test_designed`）
- 不允许 `test_case_ref` 为空时迁移到 `test_designed`
- 不允许 frontmatter 检查未通过时迁移到 `ready`
- 不允许 `review → done` 时 Agent Notes 中存在未关闭（`status != done`）的 Bug 外链

### 6.4 `req_review → ready` 前置检查清单

Claude Code 或人工将需求从 `req_review` 改为 `ready` 前，必须确认：

```bash
bash scripts/check-req-coverage.sh
```

检查项（脚本自动验证）：

- [ ] 10 个 frontmatter 字段全部存在（`req_id` / `title` / `status` / `priority` / `phase` / `owner` / `depends_on` / `test_case_ref` / `scope` / `acceptance`）
- [ ] `status` ∈ `{draft, review_ready, req_review, ready, test_designed, in_progress, blocked, review, done}`
- [ ] `scope` ∈ `{runtime, ui, tests, scripts, docs}`
- [ ] `priority` ∈ `{P0, P1, P2, P3}`
- [ ] `depends_on` 中的每个 REQ 编号在 `tasks/` 中存在
- [ ] `status == blocked` 时 `blocked_reason` 字段存在且非空（脚本自动验证）
- [ ] `status == blocked` 时 `blocked_from_status` 字段存在且非空（脚本自动验证）
- [ ] `status == blocked` かつ `blocked_reason == bug_linked` 时 `blocked_from_owner` 字段存在且非空（脚本自动验证）

### 6.5 `blocked_reason` 枚举

| 值 | 含义 |
|---|---|
| `dep_not_done` | `depends_on` 中的前置项尚未完成 |
| `review_rejected` | review 打回，需修复后重新提 PR |
| `bug_linked` | Agent Notes 中有未关闭 Bug 外链，阻止进入 `done` |
| `external_decision` | 需等待外部决策（产品、法务等）|
| `req_review_feedback` | req_review 阶段 Huahua 发现需求缺陷，开 req_bug 待修复 |

---

## 7. 优先级规范

| 优先级 | 含义 | 处理原则 |
|---|---|---|
| `P0` | 阻断开发或高风险线上问题 | 优先于其他项 |
| `P1` | 当前 Phase 的核心交付 | 应优先认领 |
| `P2` | 重要但不阻断主路径 | 在 P0/P1 后处理 |
| `P3` | 低优先级改进或整理 | 可延期 |

### 7.1 Claude Code 默认认领顺序

1. `test_designed`（或 `tc_policy=optional/exempt` 时 `ready`）且未阻塞
2. 当前 Phase 内
3. 优先级从 `P0` 到 `P3`
4. 依赖最少、验收最明确的项优先

---

## 8. 任务认领规程

### 8.1 认领前提

- [ ] `status == test_designed`（或 `tc_policy=optional/exempt` 时 `status == ready`）
- [ ] `owner == unassigned`
- [ ] `depends_on` 中所有项已 `done`
- [ ] 当 `status == test_designed` 时：`test_case_ref` 非空

### 8.2 认领动作

单 commit 直接认领：

| 步骤 | 操作 |
|---|---|
| 1 | 在工作分支上修改 `tasks/features/REQ-xxx.md`：`owner → <agent>`，`status → in_progress` |
| 2 | commit message：`claim: REQ-xxx by <agent>`（`<agent>` = `pandas` / `huahua` / `menglan` / `claude_code` / `human`）|
| 3 | 继续在同一分支上实现需求 |

### 8.3 放弃与释放

若 Agent 无法继续，必须：

- 把 `status` 改回 `test_designed`（TC 已有），或改为 `blocked`（填写 `blocked_reason`）
- 清空 `owner` 回到 `unassigned`
- 在 `Agent Notes` 中简述原因

### 8.4 多 Agent Handoff 协议

当某 Agent 完成阶段工作、需移交给另一 Agent 时：

| 步骤 | 操作 |
|---|---|
| 1 | 修改 `tasks/features/REQ-xxx.md`：`owner → <next-agent>`，根据阶段更新 `status` |
| 2 | commit message：`handoff: REQ-xxx → <next-agent>` |
| 3 | 在 `Agent Notes` 中写明移交内容和下一步期望 |

**Pandas 只锚定两个端点，中间路径 Huahua 自持：**

```
① 入口：review_ready ─(Pandas state-as-lock)─► req_review (owner=huahua)
② 出口：review ─(Daniel merge)─► done (Pandas 归档)
```

**中间路径（无 Pandas 心跳等待）：**

```
req_review (owner=huahua)
  → Huahua 评审通过：status=ready, owner=huahua（自持，不交还 Pandas）
  → Huahua TC 设计完成：status=test_designed, 直接写 Menglan inbox
  → Menglan TC review / claim：status=in_progress, owner=menglan
  → Menglan 提 PR：status=review, 直接写 Huahua inbox for code review
  → Huahua code review：通过 → Pandas 处理出口；打回 → blocked
```

折叠路径（Huahua 在 req_review 阶段同步完成 TC 设计，直接 → test_designed，跳过 ready）是中间路径的极简版。

**TC review 子路径：**

```
test_designed (Huahua 写 Menglan inbox)
  → Menglan tc_review 通过 → in_progress（Menglan 认领实现）
  → Menglan 发现 tc_bug → Huahua 修 TC → Menglan 二次确认
```

### 8.5 review_round 管理

- `review_round` 初始值为 `0`（不填写或省略）；首次打回时写入 `1`
- 每次 `review → blocked → in_progress` 循环后，`review_round` 递增
- 当 `review_round >= 2` 时，负责 review 的 Agent 须通过 `tg_decision` 升级 Daniel 决策，不得继续打回循环

---

## 9. 需求与实现同步规则

### 9.1 实现前（认领后，开始写代码前）

- [ ] 读 Phase 文档，确认当前阶段边界
- [ ] 读对应需求项，确认验收标准
- [ ] 读 `test_case_ref` 中所有 TC 文档，理解需要通过的测试场景
- [ ] 先写测试（或确认 TC 已可运行），再写实现

### 9.2 实现后（PR 提交时）

- [ ] 把需求项状态改为 `review`
- [ ] 更新 `Agent Notes`（说明实现要点、已知边界）
- [ ] 若范围变更，回写 `In Scope / Out of Scope`
- [ ] PR 描述中列出关联 TC 的通过情况

### 9.3 合并后

**责任方：Pandas**
**触发机制：** Pandas 心跳 S2 扫描 `tasks/features/` 中 `status: done` 的文件，通知 Daniel 确认后执行归档。

- [ ] （Menglan）PR 合并前在需求项写入 `status: done`，`pending_bugs` 必须为空
- [ ] （Pandas）心跳 S2 检测到 `status: done` → 发 Telegram 归档通知 Daniel
- [ ] （Pandas，Daniel 确认后）将 `tasks/features/REQ-xxx.md` 移到 `tasks/archive/done/`
- [ ] （Pandas，Daniel 确认后）将关联的 `tasks/test-cases/TC-xxx.md` 同步移到 `tasks/archive/done/`
- [ ] （Pandas）若影响阶段目标，更新对应 `phases/` 文档

---

## 10. 审查清单

### 自动可检查（脚本 / CI）

- [ ] 所有需求项 frontmatter 字段完整（含 `test_case_ref`）
- [ ] `status` 只使用允许枚举值
- [ ] `priority` 只使用 `P0/P1/P2/P3`
- [ ] `owner` 只使用 `unassigned/pandas/huahua/menglan/claude_code/human`
- [ ] `depends_on` 中的编号在 repo 中存在
- [ ] `status == test_designed` 时 `test_case_ref` 非空
- [ ] `test_case_ref` 中的 TC 文档在 `tasks/test-cases/` 中存在
- [ ] `status == in_progress` 时 `owner != unassigned`
- [ ] `status == blocked` 时 `blocked_reason` 字段存在且非空
- [ ] `status == blocked` 时 `blocked_from_status` 字段存在且非空
- [ ] `tc_policy` ∈ `{required, optional, exempt}`（字段存在时）
- [ ] `tc_policy=exempt` 时 `tc_exempt_reason` 非空
- [ ] `tc_policy=required` 且 `status ∈ {test_designed, in_progress, review, done}` 时 `test_case_ref` 非空

### 人工检查

- [ ] 每个需求项范围足够小，可被 Claude Code 独立完成
- [ ] 验收标准明确，不依赖聊天上下文
- [ ] 状态流转真实反映当前进展
- [ ] 没有两个需求项描述同一件事

---

## 11. 变更日志

| 版本 | 日期 | 变更摘要 |
|---|---|---|
| 0.1 | 2026-03-15 | 初始版本（从 hydro-om-copilot REQ-STD-001 v0.7 改写）；适配单 Agent 模式；删去 openai_codex；scope 枚举改为 open-workhorse 模块；删去 pytest_ref；简化认领为单 commit（无 Claim PR 互斥锁） |
| 0.2 | 2026-03-16 | 多 Agent 扩展（REQ-027）：owner 扩展加入 pandas/huahua/menglan；新增 blocked_reason 字段（§5.1、§6.5）；review→blocked 合法转换（§6.2）；Bug clean → done 门控（§6.2、§6.3）；新增 §8.4 handoff 协议、§8.5 review_round 管理 |
| 0.3 | 2026-03-16 | Bug 类型重设计对齐（REQ-028 计划）：新增 `req_review` 状态（§6.1）；`draft → req_review → ready` 流转（§6.2）；`draft → ready` 列为非法流转（§6.3）；§6.4 标题更新；`blocked_reason` 新增 `req_review_feedback`（§6.5）；状态总数从 7 更新为 8（§2.4）|
| 0.4 | 2026-03-17 | 流转效率 + Bug 历史归档（REQ-029）：新增 `review_ready` 状态，状态总数 8 → 9（§2.4、§6.1）；新增 `pending_bugs` 字段（§5.1、§5.2）；`ready` 语义更新为 Huahua 自持（§6.1）；§8.4 handoff 协议重写——Pandas 只锚定入口/出口两端，中间路径 Huahua 自持直写 Menglan inbox，消除 30 分钟心跳等待；REQ 模板新增 `## 关联 Bug 历史` 归档节（§5.2）|
