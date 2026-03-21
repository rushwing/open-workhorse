---
harness_id: INBOX-PROTOCOL-001
component: inbox / IPC
owner: Engineering
version: 1.1
status: active
last_reviewed: 2026-03-21
---

# Inbox Protocol — ATM Envelope 规范

> 本文档是 open-workhorse 多 Agent 系统 inbox IPC 消息 Envelope 格式的 **repo canonical 规范**。
> 如有歧义，以本文档为准。外部讨论纪要（`~/Dev/github-kb/knowledge-topics/agent-teams-messaging/`）仅供参考。
> 相关 REQ：REQ-032（Umbrella）、REQ-033（P0）、REQ-034（P1a）、REQ-035（P1b）、REQ-036（P2）
>
> **实施范围（status: active）**：ATM 四个子 REQ（REQ-033–036）全部完成。
> Pandas writer（`inbox_write_v2`）和 Pandas reader（`inbox_read_pandas`）使用 ATM Envelope 格式；
> 生命周期目录（pending/claimed/done/failed）、Thread/Correlation 追踪、Delegation 结构化、规范文件命名均已落地。
> Menglan/Huahua 的 writer 仍发旧格式，Pandas reader 通过 `_inbox_read_legacy()` 向后兼容。

---

## 1. 消息目录结构

```
$SHARED_RESOURCES_ROOT/inbox/
  for-pandas/
    pending/     # inbox_write_v2() 默认写入点
    claimed/     # 原子 mv（防重复消费）
    done/        # 处理成功
    failed/      # 处理失败（含末尾错误摘要）
  for-menglan/
    pending/ claimed/ done/ failed/
  for-huahua/
    pending/ claimed/ done/ failed/
```

> 目录由 `inbox_init()` 创建（幂等）。旧格式扁平文件（REQ-033 之前）仍可被 `_inbox_read_legacy()` 处理。

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

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | ✅ | 请求动词，见 §2.5 合法枚举 |
| `response_required` | bool | ✅ | 是否要求响应（true / false） |
| `objective` | string | ✅ | 任务目标 |
| `scope` | string | ✅ | 任务范围 |
| `expected_output` | string | ✅ | 预期产出 |
| `done_criteria` | string | ✅ | 完成标准 |
| `context_summary` | string | — | 补充上下文（超 500 字时自动截断 + warn） |
| `references` | list | — | 参考资源列表；每项 `type` 须在枚举 `req\|pr\|bug\|doc\|file` 内，否则 warn |

> **Delegation 校验**（REQ-036）：`inbox_write_v2()` 在 type=request 时校验上述四个必填字段；
> 任意字段缺失时 warn + 在 envelope 中写入 `delegation_incomplete: true`，消息仍写入。

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

### 4.1 ATM 规范格式（REQ-036 canonical，inbox_write_v2 当前使用）

```
{timestamp}_{type}_{from}_to_{to}_{corr_or_evt}.md
```

| 占位符 | 说明 |
|--------|------|
| `{timestamp}` | `YYYYMMDDHHMMSS`（UTC，`date -u +%Y%m%d%H%M%S`，无 T 分隔符、无冒号/破折号） |
| `{type}` | `request` / `response` / `notification` |
| `{from}_to_{to}` | 发送方 → 接收方，如 `pandas_to_menglan` |
| `{corr_or_evt}` | request/response：`correlation_id`；notification：`evt_{event_type}_{timestamp}` |

示例：
```
20260320174700_request_pandas_to_menglan_corr_REQ-033_1710867000.md
20260320175100_response_menglan_to_pandas_corr_REQ-033_1710867000.md
20260320180000_notification_pandas_to_menglan_evt_stall_detected_20260320180000.md
```

> **已废弃的过渡格式**（REQ-033 阶段，inbox_read_pandas() 仍可解析）：
> `{ISO8601_datetime//:/-}__{type}__{from}_to_{to}__{correlation_id}.md`（双下划线分隔）

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

| legacy_type | 路由目标 | 语义 |
|-------------|---------|------|
| `tc_complete` | `_handle_tc_complete()` | 阶段 3 TC 完成（TC 通过→触发实现） |
| `review_complete` | `_handle_review_complete()` | 阶段 5 Code Review 通过（发送 merge-ready） |
| `review_blocked` | warn only | 阶段 5 Code Review 拒绝/阻塞 |
| `dev_complete` 或空 | `_handle_dev_complete()` | 旧式实现完成（向后兼容） |

> **重要**：`legacy_type` 是 response 路由主判据（子类型路由），`status` 字段仅用于同一子类型内的成功/失败分支判定。两者协同，缺一不可。REQ-035 引入了 Thread/Correlation 追踪，但未替换 `legacy_type` 路由机制——后者仍为 Pandas reader 的 response 分派依据。

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
| `dev_complete` | `response` | _(legacy_type: dev_complete；status 从 payload 读取)_ |
| `review_complete` | `response` | _(legacy_type: review_complete；阶段 5 Code Review 完成)_ |
| `tc_complete` | `response` | _(legacy_type: tc_complete；status 从 payload 读取)_ |
| `review_blocked` | `response` | _(legacy_type: review_blocked；status: blocked)_ |
| `major_decision_needed` | `notification` | `event_type: decision_required` |

---

## 7. 处理规则

### 7.1 inbox_read_pandas() 路由逻辑

```
读取消息 type 字段
├── type ∈ {request, response, notification}  → ATM 路由
│   ├── request  → 按 action 路由到对应 handler
│   ├── response → 先按 legacy_type 路由子类型（tc_complete/review_complete/dev_complete），
│   │              再按 status 判定成功/失败路径（completed/success → 成功，其余 → 阻塞告警）
│   └── notification
│       └── severity=action-required → tg_notify
│       └── event_type=decision_required → _handle_major_decision
├── type ∈ 旧枚举 → _inbox_read_legacy()
├── type 为空 → warn + skip
└── type 未知 → warn
```

### 7.2 消费语义

1. 读取前原子 claim：`mv pending/$f claimed/$f`
   - mv 失败且源文件消失（ENOENT 竞争）→ 静默 skip，不报错
   - mv 失败且源文件仍在（真实 fs 错误）→ `err()` 输出到 stderr，skip
2. handler 执行成功：`mv claimed/$f done/$f`
3. handler 异常退出：`mv claimed/$f failed/$f`，将错误摘要追加到文件末尾

### 7.3 Thread / Correlation 规则（REQ-035）

- **thread_id**：Pandas 路由第一个 request 时通过 `thread_get_or_create <req_id>` 创建
  - 格式：`thread_{req_id}_{epoch}`
  - 持久化位置：**仅写入消息 Envelope frontmatter**，不写回 REQ 文件（Daniel 决策 2026-03-20）
  - 同一 REQ 的所有后续 request 复用相同 `thread_id`
  - 链路重建：`grep thread_id done/ failed/` 可还原完整协作轨迹

- **correlation_id**：每次新 request 由 `correlation_new <req_id>` 生成
  - 格式：`corr_{req_id}_{epoch}`
  - Response 到达时 Pandas 验证 `correlation_id` 是否与发出的 request 配对
  - 配对失败 → warn 日志 + 消息移到 `failed/`

---

## 8. 函数签名参考

```bash
# — 初始化生命周期目录（幂等，每次 cron 启动前调用）
inbox_init

# — 生成或复用 thread_id（REQ-035）
thread_id=$(thread_get_or_create "REQ-033")   # 格式：thread_REQ-033_{epoch}

# — 生成新 correlation_id（REQ-035）
corr_id=$(correlation_new "REQ-033")          # 格式：corr_REQ-033_{epoch}

# — inbox_write_v2 <target> <type> <action_or_event> <thread_id> <correlation_id>
#                  [in_reply_to] [priority] [response_required] [payload_file]
# payload_file (type=request) 必须包含 objective / scope / expected_output / done_criteria
inbox_write_v2 "menglan" "request" "implement" \
  "$thread_id" "$corr_id" \
  "" "P1" "true" "$payload_tmpfile"

# — @deprecated wrapper，委托给 inbox_write_v2
inbox_write "menglan" "implement" "REQ-033" "实现 REQ-033"
```

---

## 9. 变更日志

| 版本 | 日期 | 变更摘要 |
|------|------|---------|
| 1.0 | 2026-03-20 | 初始版本（status: partial）；REQ-033 范围：统一 ATM Envelope 格式、inbox_write_v2、_inbox_read_legacy 向后兼容、过渡文件命名格式 |
| 1.1 | 2026-03-21 | status partial → active；REQ-034–036 全部落地：生命周期目录结构（§1）、规范文件命名（§4.1）、delegation 字段规范（§2.2）、Thread/Correlation 规则（§7.3）、消费语义更新为 mv 语义（§7.2）；修正 legacy_type 注释（非过渡机制，REQ-035 未替换）；新增函数签名 inbox_init / thread_get_or_create / correlation_new（§8）|
