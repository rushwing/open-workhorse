---
runbook_id: RB-000
title: gh pr create 交互式提示导致 harness.sh 挂起
trigger_command: ./scripts/harness.sh implement REQ-N
created: 2026-03-15
status: active
---

# RB-000 — gh pr create 交互式提示导致 harness.sh 挂起

## 症状（Symptom）

`harness.sh implement` 中 Claude Code 调用 `gh pr create` 后，终端停住等待输入（title / body 交互提示），脚本不返回。

```
? Title  [Enter to skip]
? Body   [(e) to launch editor, enter to skip]
```

## 根因（Root Cause）

`gh pr create` 在没有检测到 `CI=true` 环境变量，且未指定 `--fill` / `--title` / `--body` 时会启动交互式编辑器。
`harness.sh` 原版未 export `CI=true`，导致 gh 认为是交互终端。

## 修复步骤（Fix Steps）

1. 确认 `harness.sh` 顶部已有 `export CI=true GH_NO_UPDATE_NOTIFIER=1`（v0.2+ 已内置）
2. 若 Claude Code 手动执行 `gh pr create`，必须加 `--fill` 标志：
   ```bash
   gh pr create --fill
   ```
3. 验证：`CI=true gh pr create --fill` 在 dry-run 下不出现交互提示

## 新增工具（New Tool）

无（已通过 harness.sh 环境变量修复）。

## 适用条件

- `harness.sh` 版本 < v0.2（未含 `export CI=true`）
- 或 Claude Code 在 harness.sh 外直接调用 `gh pr create` 而未加 `--fill`

## 相关

- 参考文档：`harness/agent-cli-playbook.md` 模板 B（实现 REQ 步骤 7）
- 修复已集成至：`scripts/harness.sh` v0.2，`harness/agent-cli-playbook.md` v0.2
