---
runbook_id: RB-NNN
title: <短标题，一句话描述问题>
trigger_command: <触发此问题的 harness/脚本命令>
created: YYYY-MM-DD
status: active
---

# RB-NNN — <标题>

## 症状（Symptom）

> 命令运行后观察到什么？贴错误消息或关键输出片段。

```
<error output>
```

## 根因（Root Cause）

> 为什么会发生？哪个假设被违反？

## 修复步骤（Fix Steps）

1. 步骤一
2. 步骤二
3. 验证：运行 `<验证命令>` 期望输出 `<expected>`

## 新增工具（New Tool）

> 可选：若此修复被封装为可重用脚本，填写脚本路径和用途。

| 脚本 | 用途 |
|---|---|
| `scripts/<name>.sh` | <说明> |

## 适用条件

> 仅当以下条件成立时才适用本 runbook：

- 条件 1
- 条件 2

## 相关

- REQ / BUG：
- 参考文档：
