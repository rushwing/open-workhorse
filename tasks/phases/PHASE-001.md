---
phase_id: phase-1
title: Single-Agent MVP
status: draft
priority: P1
last_updated: 2026-03-15
---

# P1 Single-Agent MVP

## Goal

Lion 在 Telegram 完成端到端任务：用户发起 → Agent 响应 → 结果可验证。

## In Scope

- Lion 接入 Telegram Bot，可收发消息
- openclaw 作为运行时，Lion AGENTS.md 加载并生效
- 至少一个端到端任务场景跑通（用户问题 → Lion 回答 → 用户确认）
- open-workhorse 监控页面可显示 Lion 健康状态

## Out of Scope

- 多 Agent 编排（Phase 1 只有 Lion 单 Agent）
- 订阅 / 付费墙
- Pi 自动化部署（列入 P2）

## Exit Criteria

- [ ] Lion 在 Telegram 完成端到端任务（用户发起 → Agent 响应 → 结果可验证）
- [ ] open-workhorse `/healthz` 返回 `status: ok`（Lion 连通）
- [ ] Telegram 消息收发延迟 < 5 s（p95）

## Dependencies

- Phase 0 exit：CI 全绿 + Harness 规程落地
- openclaw binary 可在目标环境（Mac / Pi）执行

## Notes

Lion 是第一个真实用户可见的 Agent。MVP 只需证明端到端链路可用，不追求功能完整性。
