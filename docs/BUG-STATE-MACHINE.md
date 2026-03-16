# Bug 状态机 & Owner 流转（v0.3）

> 参考规程：`harness/bug-standard.md` v0.3

---

## §1 总览状态机（含 blocked）

```
                        ┌────────────────────────────────────────────────────────┐
                        │  BUG 状态机（v0.3）                                     │
                        └────────────────────────────────────────────────────────┘

   [reported_by: human / ci / agent]

           open
            │
            │  Pandas 确认可复现
            ▼
         confirmed
            │
            │  按 bug_type 路由，fix 责任人 claim
            ▼
        in_progress ◄──────────────────────────────────────────┐
            │                    │                              │
            │  修复代码 PR 提交   │  修复方案不可行，重新评估    │
            ▼                    ▼                              │
          fixed               open                             │
            │                                                  │
            │  PR 合并，Pandas 触发回归                         │
            ▼                                                  │
        regressing                                             │
            │                   ╔══════════════════════════╗  │
            │  回归测试全通过    ║  blocked（随时可进入）    ║  │
            ▼                   ║  ← 任意状态可转入        ║  │
          closed                ║  → unblock 后回到        ║  │
            │                   ║    blocked 前的状态       ║──┘
            │  wont_fix 路径     ╚══════════════════════════╝
            ▼
         wont_fix

   注：
   - user_bug 的 closed 需提出人（用户/human）验收后才能关闭
   - 非 user_bug 由 Pandas 确认 CI 通过后直接 closed
   - blocked 进入必须填写 blocked_reason 并触发 tg_notify 告警 Daniel
```

---

## §2 5 类 Bug 各自流程图

### 2.1 req_bug — 需求缺陷（Huahua 在 req_review 阶段触发）

```
   触发时机：REQ 处于 req_review 阶段，Huahua 发现需求描述/验收标准有误

   REQ 状态联动：
   req_review ──► blocked（blocked_reason: bug_linked）

   Bug 流转：
   open
    │ Pandas claim → confirmed
   confirmed
    │ Menglan claim
   in_progress  [owner: menglan，修复需求描述]
    │ 修复完成，Huahua review
   fixed
    │ PR merge，Pandas 触发回归
   regressing
    │ CI 通过
   closed
    │
    └─► REQ 恢复：blocked → req_review（等待 Huahua 继续 review）
        最终：req_review → ready

   Owner 流转：
   open(unassigned) → confirmed(pandas) → in_progress(menglan)
     → fixed(menglan) → regressing(pandas) → closed(pandas)
```

### 2.2 tc_bug — 测试用例缺陷（Menglan 在 TC review 阶段触发）

```
   触发时机：REQ 处于 ready 阶段，Menglan 在设计 TC 时发现需求有歧义或 TC 无法落地

   REQ 状态联动：
   ready ──► blocked（blocked_reason: bug_linked）

   Bug 流转：
   open
    │ Pandas claim → confirmed
   confirmed
    │ Huahua claim
   in_progress  [owner: huahua，修正需求或 TC 设计]
    │ 修复完成，Menglan review
   fixed
    │ PR merge，Pandas 触发回归
   regressing
    │ CI 通过
   closed
    │
    └─► REQ 恢复：blocked → ready → test_designed（Menglan 完成 TC 后）

   Owner 流转：
   open(unassigned) → confirmed(pandas) → in_progress(huahua)
     → fixed(huahua) → regressing(pandas) → closed(pandas)
```

### 2.3 impl_bug — 实现缺陷（Huahua 在 PR code review 阶段触发）

```
   触发时机：REQ 处于 in_progress→review 阶段，Huahua 做 code review 时发现实现问题

   REQ 状态联动：
   in_progress ──► blocked（blocked_reason: bug_linked）
   修复后：blocked → in_progress（重新提 PR）→ review

   Bug 流转：
   open
    │ Pandas claim → confirmed
   confirmed
    │ Menglan claim
   in_progress  [owner: menglan，修复实现代码]
    │ 修复完成，Huahua review
   fixed
    │ PR merge，Pandas 触发回归
   regressing
    │ CI 通过
   closed
    │
    └─► REQ 恢复：blocked → in_progress → review（重新提 PR）

   Owner 流转：
   open(unassigned) → confirmed(pandas) → in_progress(menglan)
     → fixed(menglan) → regressing(pandas) → closed(pandas)
```

### 2.4 ci_bug — CI 自动检测缺陷（Pandas 在 CI 失败时触发）

```
   触发时机：REQ 处于 review 阶段，GitHub Actions CI 报红

   REQ 状态联动：
   review ──► blocked（blocked_reason: bug_linked）
   修复后：blocked → review → done（Daniel merge 后）

   Bug 流转：
   open
    │ Pandas 自动 claim → confirmed（Pandas 是触发者，自动确认）
   confirmed
    │ Menglan claim
   in_progress  [owner: menglan，修复 CI 失败]
    │ 修复完成，Huahua review
   fixed
    │ PR merge，Pandas 触发回归
   regressing
    │ CI 通过
   closed
    │
    └─► REQ 恢复：blocked → review（等待 Daniel merge → done）

   Owner 流转：
   open(pandas) → confirmed(pandas) → in_progress(menglan)
     → fixed(menglan) → regressing(pandas) → closed(pandas)
```

### 2.5 user_bug — 生产环境用户缺陷（用户/human 通过 GitHub issue 触发）

```
   触发时机：REQ 已 done，用户在生产使用中发现问题并提 GitHub issue

   REQ 状态联动：
   不 block REQ（done 状态不变），Bug 独立跟踪

   Bug 流转：
   open
    │ Pandas claim → confirmed（确认可复现）
   confirmed
    │ 按缺陷性质路由：实现问题→Menglan，需求问题→Huahua
   in_progress  [owner: menglan 或 huahua]
    │ 修复完成，对应 reviewer review
   fixed
    │ PR merge，Pandas 触发回归
   regressing
    │ CI 通过 + 提出人（用户/human）验收
   closed  ◄── 必须经用户验收，不可 Pandas 单方面关闭

   Owner 流转：
   open(unassigned) → confirmed(pandas)
     → in_progress(menglan 或 huahua)
     → fixed(menglan 或 huahua) → regressing(pandas)
     → [用户验收] → closed(pandas)
```

---

## §3 ReAct SOP 推理模板

Agent 收到新 Bug 时按以下模板推理：

```
Thought: 读取 bug_type 字段
Action: 查找 bug_type 对应路由规则（§2）
Observation: 确认 fix 责任人和 reviewer

Thought: 确认 REQ 联动（related_req 是否非空）
Action: 若非空，按 §2.x 更新 REQ 状态为 blocked
Observation: REQ blocked_reason 已写入

Thought: 确认 Inbox 认领状态
Action: 若 owner=unassigned，判断当前 Agent 是否为责任人
Observation: 若是，执行 claim commit；若否，等待上游路由

Thought: 检查 review_round
Action: 若 review_round >= 3，触发 tg_notify + 进入 blocked
Observation: Daniel 已告警，等待人工决策

Thought: 修复完成后，检查 regressing 口径
Action: 若 bug_type=user_bug，等待用户验收再关闭；否则 CI 通过后关闭
Observation: closed 口径满足
```

---

## §4 blocked 状态触发条件与告警规则

### 4.1 触发条件

| 触发场景 | blocked_reason |
|---------|---------------|
| review 轮次 >= 3 | `review_round_exceeded` |
| 修复方案需等待外部决策 | `external_decision` |
| 依赖的 Bug/REQ 未完成 | `dep_not_done` |
| 人工强制暂停 | `manual_hold` |

### 4.2 告警规则

- blocked 状态进入后必须在 Agent Notes 写明 blocked_reason
- `review_round_exceeded` 触发后：发送 `tg_notify` 告警给 Daniel，内容包含 Bug ID + 当前 review_round
- blocked 状态不能超过 72 小时无响应，否则再次告警

### 4.3 unblock 规则

- Daniel 人工决策后，由 Pandas 解除 blocked
- 解除时 owner 改为责任人，status 回到 blocked 前状态
- commit message：`unblock: BUG-xxx — <原因>`

---

## §5 Lesson Learned 约定

### 5.1 写入时机

以下情况必须触发 Lesson Learned：

- S1 / S2 级 Bug 关闭后
- `review_round >= 2` 的任意 Bug 关闭后
- `user_bug` 关闭后（无论严重等级）
- blocked 状态持续超过 48 小时的 Bug 关闭后

### 5.2 文件位置与命名

```
tasks/lessons-learned/LL-xxx.md   （xxx 从 001 开始递增）
```

### 5.3 写入内容

见 `tasks/lessons-learned/README.md`。

### 5.4 Owner 流转

Lesson Learned 由 Bug 的**最终 fix 责任人**在 closed 时同步创建。
Pandas 在 umbrella done 时检查是否应写 LL，若漏写则触发提醒。

---

## Owner 枚举速查

| owner 值      | 含义                              |
|---------------|-----------------------------------|
| `unassigned`  | 未认领，等待路由                  |
| `pandas`      | Pandas — 编排、监控、回归检测     |
| `huahua`      | Huahua — 需求设计 / code review   |
| `menglan`     | Menglan — 实现修复 / TC 设计      |
| `human`       | Daniel 人工介入                   |

---

## 非法流转（禁止）

```
  open ──────────────────────────────────► closed   ✗  必须经 confirmed + 回归
  fixed ─────────────────────────────────► closed   ✗  必须经 regressing
  regressing（user_bug，用户未验收）──────► closed   ✗  必须等待用户验收
  任意状态 ───────────────────────────────► blocked  ✓  合法（随时可进入，但必须填 blocked_reason）
  blocked ────────────────────────────────► closed   ✗  必须先 unblock 再走正常流程
```
