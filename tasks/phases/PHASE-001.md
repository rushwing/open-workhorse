---
phase_id: PHASE-001
title: Phase 1 — MVP 工程启动
status: in_progress
goal: 让 open-workhorse 在树莓派上可靠运行，CI 门禁就绪，Harness 规程落地
last_updated: 2026-03-15
---

# Phase 1 — MVP 工程启动

## Goal

让 open-workhorse 在树莓派上可靠运行，CI 门禁就绪，Harness 规程落地。

## In Scope

- CI 全绿（release:audit + build + test + req-coverage）
- Harness 规程文档 v0.1 完成并合入 main
- GitHub Actions workflow 接入
- 至少一个 REQ 通过完整 harness 流程（draft → done）
- Pi 部署文档（docs/SETUP.md）可操作

## Out of Scope

- 多 Agent 编排（当前阶段单 Claude Code + Daniel）
- LLM API 集成（open-workhorse 本身不调用 LLM）
- Daily / Weekly 定时构建
- 高覆盖率测试（当前目标：全部通过即达标）
- Memory Bank（架构决策记忆层，列入 Phase 2 Todo）

## Todo（Phase 2+）

- [ ] **Memory Bank**：参考 Cline Memory Bank 模式，新增 `memory/` 目录（`productContext.md`、`systemPatterns.md`、`activeContext.md` 等），补充架构决策背景，增强 Claude Code 跨 session 上下文恢复能力

## Entry Criteria

- open-workhorse 可以 `npm run dev:ui` 本地启动
- `npm test` 有至少一个通过的测试

## Exit Criteria

- [ ] CI 全绿（release:audit + build + test）
- [ ] GitHub Actions `.github/workflows/ci.yml` 接入并在 main 上运行
- [ ] Harness 规程文档 v0.1 完成并合入 main（harness/ 目录）
- [ ] `./scripts/harness.sh status` 可执行，输出 claimable tasks 或 "no claimable tasks"
- [ ] `bash scripts/check-req-coverage.sh` 在空 tasks/ 时 exit 0
- [ ] 至少一个 REQ 从 draft 走到 done

## Active REQs

（待添加）

## Agent Notes

Phase 1 是 Harness Engineering 迁移的第一个阶段。
主要工作：完成 harness/ 规程文档、scripts/ 工具、GitHub Actions CI、tasks/ 目录骨架。
