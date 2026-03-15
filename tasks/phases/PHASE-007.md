---
phase_id: phase-7
title: Subscription Infrastructure
status: draft
priority: P3
last_updated: 2026-03-15
---

# P7 Subscription Infrastructure

## Goal

NCloud + Tailscale + 许可证 + 订阅分发系统打通。

## In Scope

- NCloud 集成（设备注册、远程管理）
- Tailscale 网络打通（设备互联）
- 许可证系统（激活码 / 订阅验证）
- 订阅分发流程（购买 → 激活 → 更新推送）

## Out of Scope

- 第三方 Agent 商店（Phase 8）

## Exit Criteria

- [ ] NCloud + Tailscale + 许可证 + 订阅分发系统打通（端到端流程可演示）
- [ ] 新设备激活时间 < 5 min
- [ ] 订阅续期自动推送更新

## Dependencies

- Phase 5/6 exit：有足够订阅用户验证基础设施需求

## Notes

基础设施建设阶段，用户感知不强，但是规模化的前提。
