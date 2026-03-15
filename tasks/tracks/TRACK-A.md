---
track_id: track-a
title: 工程 Agent Team
status: active
agents: Pandas / Huahua / Menglan
active_during: P1–P3 并行
last_updated: 2026-03-15
---

# Track A — 工程 Agent Team

## Goal

支撑业务主线各 Phase 的工程实现，保证代码质量、CI 可靠性和工程规范落地。

## Agents

| Agent | 角色 | 模型推荐 |
|-------|------|----------|
| Pandas | 工程 EM，任务分发，与 Daniel 沟通 | Kimi 2.5 / Fast |
| Menglan | 实现者，Claude Code，执行编码任务 | Claude Code |
| Huahua | 审查者，Codex / o-series，负责 review | Codex / OpenAI o-series |

## Work Loop

1. Daniel → Pandas：下发任务（需求 / Bug / REQ）
2. Pandas → Menglan：拆分并分发实现任务
3. Menglan → Huahua：提交 review brief
4. Huahua → Pandas：返回审查结论
5. Pandas → Daniel：汇报结果

## Active During

P1–P3 并行运转。随项目规模增长逐步扩容（可加入专项工程 Agent）。

## Notes

Pandas 是唯一与 Daniel 直接对话的工程 Agent。Menglan 和 Huahua 只被 Pandas spawn，不直接接受用户指令。
