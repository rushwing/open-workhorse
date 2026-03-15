---
phase_id: phase-2
title: Appliance Ready
status: draft
priority: P1
last_updated: 2026-03-15
---

# P2 Appliance Ready

## Goal

一键部署脚本在全新 Pi 上 < 15 min 跑通；Tiger 可管控 Pi 设备状态。

## In Scope

- Pi 一键部署脚本（clone → env → systemctl → 健康检查）
- Tiger Agent 接入：设备健康监控、依赖更新、异常告警
- open-workhorse 在 Pi 上稳定运行（systemctl --user 管理）
- 远程管控能力（Tailscale 或同等方案）

## Out of Scope

- 多用户 / 多设备管理（Phase 7）
- 付费许可证（Phase 7）

## Exit Criteria

- [ ] 一键部署脚本在全新 Pi 上 < 15 min 跑通（有录屏或日志证明）
- [ ] Tiger 可管控 Pi 设备状态（重启服务、报告健康、触发更新）
- [ ] `systemctl --user status openclaw` 显示 active

## Dependencies

- Phase 1 exit：Lion 端到端 MVP 验证完成

## Notes

"Appliance" 定义：用户不需要懂服务器，插上电就能用。Tiger 是让设备自我维护的关键 Agent。
