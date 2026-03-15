# open-workhorse

> **"The Chosen Ones"** — 天选打工人 AI 团队管理系统，OpenClaw 后端专属。

Language: [English](README.en.md) | **中文**

---

```
它们不休假。不请假。不摸鱼。
它们是天选打工人。
你只需要盯着它们干活。
```

---

## 这个项目是什么

`open-workhorse` 是一套为 [OpenClaw](https://github.com/TianyiDataScience/openclaw-control-center) 后端打造的本地控制中心。

你的 AI Agent Team 在后台默默运转——Lion 深度思考、Otter 发早报、Pandas 调度代码、Monkey 产出内容。它们是天选的，不需要休息。但你需要知道它们在干什么、有没有卡住、花了多少钱。

这就是 `open-workhorse` 存在的理由。

**基于** [openclaw-control-center](https://github.com/TianyiDataScience/openclaw-control-center)（MIT License，作者 [@TianyiDataScience](https://github.com/TianyiDataScience)）改造，在此致谢原作者的开放与慷慨。

---

## 你能得到什么

| 页面 | 一句话 |
|------|--------|
| **总览** | 现在一切正常吗？谁在忙、谁卡了、有什么需要你拍板 |
| **员工** | 谁真的在跑任务，谁只是在排队 |
| **任务** | 任务板 + 审批队列 + 执行链证据 |
| **用量** | 今天烧了多少，趋势如何，额度还剩多少 |
| **文档 & 记忆** | 直接读写 Agent 的工作文档和长期记忆源文件 |
| **设置** | 哪些数据源接好了，哪些高风险操作故意关着 |

---

## 安全第一，默认保守

天选打工人可以放权，但不能失控。

- `READONLY_MODE=true` — 默认只读
- `LOCAL_TOKEN_AUTH_REQUIRED=true` — 默认本地 token 鉴权
- `APPROVAL_ACTIONS_ENABLED=false` — 审批动作默认关闭
- `IMPORT_MUTATION_ENABLED=false` — 导入写操作默认关闭

你可以看，但不会在你不知情的情况下改任何东西。

---

## 5 分钟启动

```bash
npm install
cp .env.example .env
npm run build
npm test
npm run smoke:ui
UI_MODE=true npm run dev
```

打开：
- `http://127.0.0.1:4310/?section=overview&lang=zh`
- `http://127.0.0.1:4310/?section=overview&lang=en`

---

## 首次接入：让你的 OpenClaw 代劳

最省事的方式：把下面这段交给你自己的 OpenClaw，让它帮你完成安装和接线。
独立文件版本见 [INSTALL_PROMPT.md](INSTALL_PROMPT.md)。

<details>
<summary>展开安装指令</summary>

```text
你现在要帮我把 open-workhorse 安装并接到这台机器自己的 OpenClaw 环境上。

你的目标不是解释原理，而是直接完成一次安全的首次接入。

严格约束：
1. 只允许在 open-workhorse 仓库里工作。
2. 除非我明确要求，否则不要修改应用源码。
3. 不要修改 OpenClaw 自己的配置文件。
4. 不要开启 live import，不要开启 approval mutation。
5. 所有高风险写操作保持关闭。
6. 不要假设这台机器使用默认 agent 名称、默认路径、默认订阅方式，必须以实际探测结果为准。
7. 不要把"缺少订阅数据 / 缺少 Codex 数据 / 缺少账单快照"当成安装失败；只要 UI 能安全跑起来，就应当继续并明确哪些面板会降级。
8. 不要伪造、生成、改写任何 provider API key、token、cookie 或外部凭证；如果 OpenClaw 本身缺少这些前置条件，只能报告，不要替用户猜。

请按顺序完成：环境确认 → 安装依赖 → 写入安全默认配置 → build/test/smoke → 交付可启动结果。

最后用这个格式给我结果：
- 环境检查
- 差异与降级判断
- 实际修改
- 验证结果
- 下一步命令
- 首次打开页面
```

</details>

---

## 手动配置 `.env`

```dotenv
GATEWAY_URL=ws://127.0.0.1:18789
READONLY_MODE=true
APPROVAL_ACTIONS_ENABLED=false
APPROVAL_ACTIONS_DRY_RUN=true
IMPORT_MUTATION_ENABLED=false
IMPORT_MUTATION_DRY_RUN=false
LOCAL_TOKEN_AUTH_REQUIRED=true
UI_MODE=false
UI_PORT=4310

# 路径不是默认值时才需要设置：
# OPENCLAW_HOME=/path/to/.openclaw
# CODEX_HOME=/path/to/.codex
# OPENCLAW_SUBSCRIPTION_SNAPSHOT_PATH=/path/to/subscription.json
```

---

## 本地命令

```bash
npm run build
npm run dev
npm run dev:ui          # UI only
npm run dev:continuous  # 持续监控模式
npm run smoke:ui        # 快速冒烟
npm test
npm run validate
npm run command:backup-export
npm run release:audit   # 发布前审计（维护者用）
```

---

## HTTP 接口（部分常用）

```
GET  /snapshot                         原始快照 JSON
GET  /api/projects                     项目列表
GET  /api/tasks                        任务列表
GET  /api/sessions                     会话列表
GET  /api/usage-cost                   用量与花费快照
GET  /api/action-queue                 待处理队列
GET  /api/approvals/:id                审批详情
GET  /digest/latest                    最新日报 HTML
GET  /healthz                          系统健康
GET  /api/replay/index                 回放索引
POST /api/approvals/:id/approve|reject 审批动作（需要开关和 token）
POST /api/import/live                  Live import（高风险，默认关闭）
```

完整接口文档见 [README.en.md](README.en.md#local-http-endpoints) 或 `GET /api/docs`。

---

## Runtime 文件

```
runtime/
├── last-snapshot.json
├── timeline.log
├── projects.json
├── tasks.json
├── budgets.json
├── digests/YYYY-MM-DD.md      ← Lion 和 Otter 消费这里
├── doc-hub-chat.json          ← 结构化聊天文档索引
├── export-snapshots/
└── exports/
```

---

## 文档

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
- [`docs/PROGRESS.md`](docs/PROGRESS.md)

---

## 致谢

`open-workhorse` 基于 [TianyiDataScience/openclaw-control-center](https://github.com/TianyiDataScience/openclaw-control-center)（MIT License）改造。
感谢原作者打造了这套扎实的基础设施，并慷慨地开放给大家随意改造。

---

*天选打工人，一生都在线。*
