---
track_id: track-d
title: 教育陪伴 Agent
status: placeholder
agents: Owl (Momo 默默)
active_during: P6 发力
last_updated: 2026-03-15
---

# Track D — 教育陪伴 Agent

## Goal

为儿童 / 学习者提供有耐心、知识渊博的 AI 学习伴侣，P6 阶段以 Beta 形式对外发布。

## Agents

| Agent | 中文名 | 角色 | 模型推荐 |
|-------|--------|------|----------|
| Owl | Momo 默默 | 教育陪伴，覆盖数学 / 英语 / 中文阅读 / 编程 | Claude Sonnet / Haiku |

## Persona — Momo 默默

- **性格**：有耐心、知识渊博、陪伴感强
- **风格**：从不催促，永远鼓励，用孩子能懂的语言解释复杂概念
- **场景**：数学辅导、英语对话练习、中文阅读理解、编程启蒙

> 以前叫 Tutor，现统一更名为 **Owl（Momo 默默）**。
> 对应 personas 目录：`workspace-owl`（原 `workspace-tutor`）。

## Subject Tracks

| 科目 | Sub-persona | 目录 |
|------|-------------|------|
| 数学 | math_coach | `workspace-owl/subjects/math_coach/` |
| 英语 | english_partner | `workspace-owl/subjects/english_partner/` |
| 中文阅读 | chinese_reader | `workspace-owl/subjects/chinese_reader/` |
| 编程启蒙 | coding_coach | `workspace-owl/subjects/coding_coach/` |

## Active During

P6 核心：Owl Tutor 套件 Beta 发布。P1–P5 期间作为 placeholder，可内部测试。

## Notes

Owl 的工作空间独立于主线 Agent Team（不参与 P1–P5 的 Telegram / 内容流水线工作）。
P6 Beta 阶段目标：验证儿童/学习者的实际使用反馈，不追求功能完整性。
