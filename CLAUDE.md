# open-workhorse — Claude Code Context Guide

本项目是基于 [openclaw-control-center](https://github.com/TianyiDataScience/openclaw-control-center)（MIT License）
改造而来的个人 OpenClaw 控制中心，服务于 Daniel 的 Agent Team。

---

## Agent Team 背景

本项目的改造目标是为以下 Agent Team 提供观测与管控能力。
完整的 Agent Team 蓝图见：`/Users/danielwong/Dev/everything_openclaw/`

### 关键参考文件

| 文件 | 内容 |
|------|------|
| `/Users/danielwong/Dev/everything_openclaw/personas/WORKSPACE_BLUEPRINT.md` | Agent Team 架构设计理念（为什么 activity-based） |
| `/Users/danielwong/Dev/everything_openclaw/personas/TEAM_ROSTER.md` | 全体 Agent 快速索引表 |
| `/Users/danielwong/Dev/everything_openclaw/personas/shared-resources/FLOW.md` | 跨 Agent 通信规则与保留策略 |
| `/Users/danielwong/Dev/everything_openclaw/openclaw/OVERVIEW.md` | OpenClaw 核心概念与架构 |

### Agent Team 成员速览（Phase 1 活跃）

| Agent | 角色 | 与本项目的关联 |
|-------|------|----------------|
| 🦁 Lion | 深度思考、综合判断、长期记忆 | 消费 digest 摘要、doc-hub 文档用于长期洞察 |
| 🐼 Pandas | 工程经理，分派 menglan/huahua | 关注 session 健康、任务状态、approval 队列 |
| 🐒 Menglan | 实现者（由 pandas 生成） | Claude Code 执行者，使用本控制中心监控自身会话 |
| 🐦 Huahua | Reviewer（由 pandas 生成） | 关注代码审查结果，不直接与 Daniel 交互 |
| 🦦 Otter | 日程、待办、每日 7:30 早报 | 关注 projects/tasks API，消费 digest 生成早报 |
| 🐒 Monkey | 内容流水线：视频→文章 | 消费 intel 摘要，不直接使用控制中心 |

### Phase 2 待激活

| Agent | 计划角色 |
|-------|---------|
| 🐓 Coq | 每日情报、网络搜索简报 |
| 🐯 Tiger | 安全扫描、系统健康检查 |

---

## 本项目对 Agent Team 的价值

改造时优先考虑以下 Agent 的使用需求：

### Otter（最高优先级）
- 需要 `/api/tasks`、`/api/projects` 数据来生成早报
- 早报格式：`📅日期 天气 重点邮件 今日待办 昨日未完成`
- 待办超过 10 条时需要触发提醒

### Lion
- 消费 `/digest/latest` 和 `runtime/digests/` 里的日报
- 用于长期记忆和模式识别
- doc-hub 中的结构化聊天文档是其重要输入

### Pandas / Menglan
- 关注 approval 队列（`/api/approvals`）
- 关注会话健康状态（`/api/sessions`）
- 多文件改动、权限相关代码 → 必须触发 Huahua review

---

## 本项目关键运行时数据路径

```
open-workhorse/
└── runtime/
    ├── digests/           # 日报 Markdown 文件（Lion/Otter 消费）
    ├── doc-hub-chat.json  # 结构化聊天文档索引（Lion 消费）
    ├── evidence/          # 证据报告
    └── snapshots/         # 导出快照
```

---

## 商业背景（kaigongba-pro）

本项目是"开工吧 (Kaigongba)"产品体系的开源核心。

| 文件 | 内容 |
|------|------|
| `/Users/danielwong/Dev/kaigongba-pro/BUSINESS_PLAN.md` | 商业企划书（定位、护城河、竞对）|
| `/Users/danielwong/Dev/kaigongba-pro/ACTION_PLAN.md` | 行动计划与里程碑 |
| `/Users/danielwong/Dev/kaigongba-pro/GAP_ANALYSIS.md` | 当前 P0/P1/P2 Gap 清单 |
| `/Users/danielwong/Dev/kaigongba-pro/SYNC_ARCHITECTURE.md` | 三仓同步体系设计 |

**当前 P0 优先级**：补 `.env.example`、补 CI、修正 `package.json` name、更新 `docs/PUBLISHING.md`。

---

## 改造原则

1. **不破坏上游兼容性**：上游 openclaw-control-center 是 MIT License，改动应清晰标记
2. **Agent 优先**：功能改造以 Agent Team 实际使用场景为准，不做多余抽象
3. **Otter 的 tasks/projects API 是核心**：保持稳定，Agent 依赖这些端点
4. **审计与 approval 流程不简化**：Pandas 团队依赖这些保障代码质量
5. **readonly 模式默认开启**：`READONLY_MODE=true`，mutation 需要明确授权
