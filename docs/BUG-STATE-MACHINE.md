# Bug 状态机 & Owner 流转

> 参考规程：`harness/bug-standard.md` v0.2

---

## 状态机（完整流转）

```
                        ┌─────────────────────────────────────────────────────┐
                        │  BUG 状态机                                          │
                        └─────────────────────────────────────────────────────┘

   [reported_by: human / ci / agent]

           open
            │
            │  确认可复现
            ▼
         confirmed ──────────────────────────────────────────┐
            │                                                 │
            │  Agent 认领                                     │  wont_fix
            ▼                                                 │  （无需修复）
        in_progress ─────────────────────────────────────────┤
            │                    │                            │
            │  修复代码 PR 提交   │  修复方案不可行，重新评估  │
            ▼                    ▼                            │
          fixed               open ◄──────────────────────── ┘
            │
            │  PR 合并，运行回归测试
            ▼
        regressing
            │
            │  回归测试全通过
            ▼
          closed
```

---

## Owner 流转（多 Agent 协作路径）

```
                     Bug 开立
                        │
                        ▼
            ┌───────────────────────┐
            │  owner: unassigned    │  status: open
            │  reported_by: human / │
            │  ci / agent           │
            └───────────┬───────────┘
                        │
                        │  人工或 Pandas 确认可复现
                        ▼
            ┌───────────────────────┐
            │  owner: unassigned    │  status: confirmed
            └───────────┬───────────┘
                        │
            ┌───────────┴────────────────────────────────┐
            │  按 Bug 归属路由 owner                      │
            │                                            │
            ▼                                            ▼
   ┌────────────────┐                        ┌────────────────────┐
   │ owner: huahua  │                        │  owner: menglan    │
   │ （代码实现层）  │                        │  （测试/TC 层）     │
   │ status:        │                        │  status:           │
   │ in_progress    │                        │  in_progress       │
   └───────┬────────┘                        └────────┬───────────┘
           │                                          │
           │  修复完成，提 PR                          │  修复完成，提 PR
           ▼                                          ▼
   ┌────────────────┐                        ┌────────────────────┐
   │ owner: huahua  │                        │  owner: menglan    │
   │ status: fixed  │                        │  status: fixed     │
   └───────┬────────┘                        └────────┬───────────┘
           │                                          │
           └──────────────┬───────────────────────────┘
                          │
                          │  Pandas 检测 PR merged，触发回归
                          ▼
              ┌─────────────────────────┐
              │  owner: pandas          │  status: regressing
              │  （监控回归结果）         │
              └────────────┬────────────┘
                           │
                           │  回归测试全通过
                           ▼
              ┌─────────────────────────┐
              │  owner: pandas /        │  status: closed
              │          unassigned     │  → 归档至 tasks/archive/done/
              └─────────────────────────┘
```

---

## Bug → REQ Blocking 联动

```
   Bug 开立（related_req 非空）
           │
           │  §2.2：开 Bug 时同步联动
           ▼
   REQ Agent Notes 追加 Bug 外链
   REQ status → blocked
   REQ blocked_reason: bug_linked
   REQ owner → unassigned
           │
           │  （Bug 修复中...）
           │
   Bug status → closed
           │
           │  §2.3：Bug 关闭时同步联动
           ▼
   检查 REQ Agent Notes 所有 Bug 外链
           │
     ┌─────┴──────────────────────────┐
     │ 仍有未关闭 Bug？                │
     ▼                                ▼
   继续 blocked                REQ 可离开 blocked
                                blocked_reason 清除
                                REQ → in_progress / review
```

---

## Owner 枚举速查

| owner 值      | 含义                              |
|---------------|-----------------------------------|
| `unassigned`  | 未认领，等待路由                  |
| `pandas`      | Pandas — 编排、监控、回归检测     |
| `huahua`      | Huahua — 代码实现层修复           |
| `menglan`     | Menglan — 测试/TC 层修复          |
| `claude_code` | 通用 Claude Code（单 Agent 路径） |
| `human`       | Daniel 人工介入                   |

---

## 非法流转（禁止）

```
  open ──────────────────────────────────► closed   ✗  必须经 confirmed + 回归
  fixed ─────────────────────────────────► closed   ✗  必须经 regressing
  in_progress（tc_policy=required, related_tc=[]） ✗  必须先填 related_tc
```
