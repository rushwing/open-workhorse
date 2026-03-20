---
harness_id: INBOX-PROTOCOL-001
component: inbox / IPC
owner: Engineering
version: 1.0
status: partial
scope_note: "REQ-033（Pandas read/write）active。Menglan/Huahua writer 迁移待 REQ-034+。"
last_reviewed: 2026-03-20
---

# Inbox Protocol — ATM Envelope 规范

> 本文档是 open-workhorse 多 Agent 系统 inbox IPC 消息 Envelope 格式的 **repo canonical 规范**。
> 如有歧义，以本文档为准。外部讨论纪要（`~/github-kb/rushwing/knowledge-topics/agent-teams-messaging/`）仅供参考。
> 相关 REQ：REQ-032（Umbrella）、REQ-033（P0）、REQ-034（P1a）、REQ-035（P1b）、REQ-036（P2）
>
> **实施范围（status: partial）**：REQ-033 范围内，Pandas writer（`inbox_write_v2`）和 Pandas reader（`inbox_read_pandas`）已升级为 ATM Envelope 格式。Huahua reader 已同步支持 ATM request 路由。Menglan/Huahua 的 writer 仍发旧格式，Pandas reader 通过 `_inbox_read_legacy()` 向后兼容——writer 侧迁移待 REQ-034+。

---

## 1. 消息目录结构

```
$SHARED_RESOURCES_ROOT/inbox/
  for-pandas/          # Pandas 收件箱（扁平目录，REQ-033）
  for-menglan/         # Menglan 收件箱
  for-huahua/          # Huahua 收件箱
```

> REQ-034（ATM-P1a）将引入 `pending/claimed/done/failed/` 子目录。

---

## 2. ATM Envelope 格式（REQ-033）

### 2.1 必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `message_id` | string | 唯一消息 ID，格式：`msg_{from}_{yyyymmddHHMMSS}_{rand4}` |
| `type` | enum | `request` \| `response` \| `notification` |
| `from` | string | 发送方 agent 名称（pandas / menglan / huahua） |
| `to` | string | 接收方 agent 名称 |
| `created_at` | ISO 8601 | 创建时间（UTC），格式：`YYYY-MM-DDTHH:MM:SSZ` |
| `thread_id` | string | 同一任务链路的追踪 ID，格式：`thread_{req_id}_{epoch}` |
| `correlation_id` | string | 单次请求-响应对的关联 ID，格式：`corr_{req_id}_{epoch}` |
| `priority` | enum | `P0` \| `P1` \| `P2` \| `P3` |

### 2.2 type=request 附加字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `action` | string | 请求动词，见 §2.5 合法枚举 |
| `response_required` | bool | 是否要求响应（true / false） |

### 2.3 type=response 附加字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `in_reply_to` | string | 对应 request 的 `message_id` |
| `status` | enum | `completed` \| `partial` \| `blocked` \| `failed` \| `rejected` \| `deferred` |
| `summary` | string | 简要说明（选填） |

### 2.4 type=notification 附加字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `event_type` | string | 事件类型，见 §2.7 枚举 |
| `severity` | enum | `info` \| `warn` \| `action-required` |

---

## 3. 合法枚举

### 2.5 request action 枚举

| action | 发送方 | 接收方 | 说明 |
|--------|--------|--------|------|
| `implement` | Pandas | Menglan | TC 已完成或 tc_policy=exempt，开始实现 |
| `tc_design` | Pandas | Huahua | 需要 TC 设计或修复 |
| `review` | Pandas | Huahua | 需要 PR code review（canonical；`code_review` 为兼容别名，reader 端接受，writer 端只写 `review`） |
| `bugfix` | Pandas | Menglan | 需要 Bug 修复 |
| `fix_review` | Pandas | Menglan | 需要修复 review findings |
| `escalate` | Any | Pandas | 升级决策 |
| `clarify` | Any | Pandas | 需要澄清 |
| `decision_required` | Any | Pandas | 重大决策请求 |

### 2.6 response status 枚举

| status | 说明 | 兼容别名 |
|--------|------|---------|
| `completed` | 任务成功完成（ATM canonical） | `success`（legacy，reader 接受） |
| `partial` | 部分完成，需后续处理 | — |
| `blocked` | 被阻塞，需升级 | — |
| `failed` | 执行失败 | — |
| `rejected` | 被 review 拒绝 | — |
| `deferred` | 延期处理 | — |

> **兼容说明**：`_handle_dev_complete()` 和 `_handle_tc_complete()` 同时接受 `success`（旧）和 `completed`（ATM 协议）作为成功路径。Writer 新实现应写 `completed`；Pandas orchestrator 两者都能正确路由。

### 2.7 notification event_type 枚举

| event_type | 说明 |
|------------|------|
| `decision_required` | 需要人工决策 |
| `pipeline_failed` | CI/流水线失败 |
| `deploy_complete` | 部署完成 |
| `artifact_created` | 产物已创建 |
| `stall_detected` | 任务停滞告警 |

---

## 4. 文件命名

### 4.1 ATM 过渡格式（REQ-033，inbox_write_v2 当前使用）

> 注：REQ-033 范围内 `inbox_write_v2()` 使用如下**过渡格式**用于 Envelope 消息可识别性。
> 最终规范化命名（含 `_` 分隔符）由 **REQ-036（ATM-P2）** 定义。

```
{ISO8601_datetime//:/-}__{type}__{from}_to_{to}__{correlation_id}.md

示例：
2026-03-20T17-47-00Z__request__pandas_to_menglan__corr_REQ-033_1710867000.md
```

### 4.2 旧格式（legacy，兼容期）

```
{YYYY-MM-DD}-{sender}-{type}-{work_item_id}-{PID}-{RANDOM}.md

示例：
2026-03-19-pandas-implement-REQ-032-1234-5678.md
```

旧格式文件可被 `inbox_read_pandas()` 通过 `_inbox_read_legacy()` 正常处理。
文件命名规范统一升级计划见 REQ-036（ATM-P2）。

---

## 5. Payload 区域

Envelope `---` 之后为 payload 区域（可选），包含：
- type-specific 附加字段（如 `req_id`, `summary`, `pr_number`）
- `legacy_type:` 字段 — `inbox_write()` wrapper 写入，供 response 路由区分 `tc_complete` / `dev_complete`
- Markdown body（自由格式任务上下文）

### legacy_type 字段

`inbox_write()` 在生成 `type=response` 消息时，会在 payload 中写入：

```yaml
legacy_type: tc_complete   # 或 dev_complete, review_blocked
```

`inbox_read_pandas()` 的 response 路由优先读取 `legacy_type` 进行分支：

| legacy_type | 路由目标 |
|-------------|---------|
| `tc_complete` | `_handle_tc_complete()` |
| `review_blocked` | warn only |
| `dev_complete` 或空 | `_handle_dev_complete()` |

---

## 6. 旧格式映射表（§9.1 — 向后兼容）

| 旧 type 值 | 新 type | 新 action / event_type |
|------------|---------|------------------------|
| `implement` | `request` | `action: implement` |
| `tc_design` | `request` | `action: tc_design` |
| `code_review` | `request` | `action: review`（规范化为 canonical）|
| `bugfix` | `request` | `action: bugfix` |
| `fix_review` | `request` | `action: fix_review` |
| `escalate` | `request` | `action: escalate` |
| `clarify` | `request` | `action: clarify` |
| `dev_complete` | `response` | _(status 从 payload 读取)_ |
| `tc_complete` | `response` | _(status 从 payload 读取)_ |
| `review_blocked` | `response` | _(status: blocked)_ |
| `major_decision_needed` | `notification` | `event_type: decision_required` |

---

## 7. 处理规则

### 7.1 inbox_read_pandas() 路由逻辑

```
读取消息 type 字段
├── type ∈ {request, response, notification}  → ATM 路由
│   ├── request  → 按 action 路由到对应 handler
│   ├── response → 按 status 路由（默认 → _handle_dev_complete）
│   └── notification
│       └── severity=action-required → tg_notify
│       └── event_type=decision_required → _handle_major_decision
├── type ∈ 旧枚举 → _inbox_read_legacy()
├── type 为空 → warn + skip
└── type 未知 → warn
```

### 7.2 消费语义

- 处理成功：`rm -f` 消息文件（当前，REQ-033）
- REQ-034 引入后：处理成功 → `mv claimed/ → done/`；失败 → `mv claimed/ → failed/`

---

## 8. 函数签名参考

```bash
# inbox_write_v2 <target> <type> <action_or_event> <thread_id> <correlation_id>
#                [in_reply_to] [priority] [response_required] [payload_file]
inbox_write_v2 "menglan" "request" "implement" \
  "thread_REQ-033_$(date +%s)" "corr_REQ-033_$(date +%s)" \
  "" "P1" "true" "$payload_tmpfile"

# inbox_write — @deprecated wrapper, delegates to inbox_write_v2
inbox_write "menglan" "implement" "REQ-033" "实现 REQ-033"
```
