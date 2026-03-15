---
track_id: track-c
title: 设备运维 Agent
status: placeholder
agents: Tiger
active_during: P2 核心（前移）
last_updated: 2026-03-15
---

# Track C — 设备运维 Agent

## Goal

让 Pi 设备自我维护：健康监控、依赖更新、异常告警，实现"插电即用"的 Appliance 体验。

## Agents

| Agent | 角色 | 模型推荐 |
|-------|------|----------|
| Tiger | 安全扫描、系统健康检查、设备运维 | 任意小型可靠模型 |

## Work Loop

1. Tiger 定期检查设备健康状态（CPU / 内存 / 磁盘 / 服务状态）
2. 发现异常 → 触发自动修复（重启服务）或告警（发送到 Daniel inbox）
3. 定期检查依赖更新，拉取并应用
4. 多设备场景：Tiger 汇总所有 Pi 节点状态

## Active During

P2 核心阶段（Appliance Ready）。Tiger 是 P2 exit criteria 的关键：Tiger 可管控 Pi 设备状态。

## Notes

Tiger 目前在 `personas/phase2/workspace-tiger/` 处于 placeholder 状态。
激活时：`git mv personas/phase2/workspace-tiger personas/workspace-tiger`。
