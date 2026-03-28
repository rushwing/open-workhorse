---
harness_id: TEST-001
component: testing / verification
owner: Engineering
version: 0.4
status: active
last_reviewed: 2026-03-28
---

# Harness Standard — 测试与验证规程

> 本规范定义 open-workhorse 在 Harness Engineering 范式下的测试分层、
> mock 策略、运行门禁与验收口径。
> 技术栈：TypeScript / Node.js，node:test 内置测试框架，无 Python/React/Playwright E2E。

---

## 1. 适用范围

- **组件**：runtime 监控、UI 服务器、clients 适配器、脚本工具
- **输入类型**：代码、配置、测试夹具、mock 数据
- **触发时机**：
  - [ ] 新增测试框架、测试目录或运行脚本时
  - [ ] 新增外部依赖时
  - [ ] 修改 PR / CI 测试门禁时

---

## 2. 测试分层规范

> 当前阶段：全部通过即达标，无覆盖率数字要求。

| 层 | 名称 | 工具 | 命令 | CI 时机 |
|----|------|------|------|---------|
| L1 | 单元测试 | node:test + tsx | `npm test` | PR gate |
| L2 | UI Smoke | ui-smoke.js | `npm run smoke:ui` | 本地预 PR（需 openclaw binary）|
| L3 | 构建验证 | tsc | `npm run build` | PR gate |
| L4 | 发布门禁 | release-audit.sh | `npm run release:audit` | PR gate |

> **smoke:ui 不进 CI**：`npm run smoke:ui` 需要真实 openclaw binary 在 PATH，CI 环境无法满足，仅作本地门禁。

---

## 2.1 单元测试（L1）

| 项目 | 内容 |
|---|---|
| 框架 | Node.js 内置 `node:test`，运行器用 `tsx`（TypeScript 直接执行）|
| 文件位置 | `test/**/*.test.ts` |
| 运行命令 | `npm test`（即 `node --import tsx --test test/**/*.test.ts`）|
| 隔离要求 | 必须隔离真实 openclaw CLI 调用（`execFile` 层 mock）；隔离文件系统副作用 |
| mock 机制 | `node:test` 内置 `mock.fn()` + `mock.method()`；fixture JSON 文件 |
| 好示例 | mock `execFile` 返回固定 JSON，验证 runtime 状态解析逻辑 |
| 坏示例 | 单元测试里真实调用 openclaw CLI 或发起 HTTP 请求 |

### 2.1.1 Mock 策略

```typescript
import { mock } from 'node:test';

// mock execFile
mock.method(childProcess, 'execFile', (cmd, args, opts, callback) => {
  callback(null, JSON.stringify(fixture), '');
});
```

### 2.1.2 Fixture 目录

```
test/fixtures/
  openclaw/    # openclaw CLI 输出 fixture（JSON 格式）
  sessions/    # 会话数据 fixture
```

---

## 2.2 UI Smoke（L2）

| 项目 | 内容 |
|---|---|
| 脚本 | `scripts/ui-smoke.js` |
| 命令 | `npm run smoke:ui` |
| 前提 | openclaw binary 在 PATH，`.env` 已配置 |
| 验证范围 | UI 服务器启动、/healthz 返回 ok、基本路由可达 |
| CI | 不进 CI（需真实 binary） |

---

## 2.3 构建验证（L3）

| 项目 | 内容 |
|---|---|
| 工具 | TypeScript 编译器（`tsc`）|
| 命令 | `npm run build` |
| 验证范围 | 全量类型检查，输出 `dist/` |
| 失败含义 | 类型错误或缺失文件 |

---

## 2.4 发布门禁（L4）

| 项目 | 内容 |
|---|---|
| 脚本 | `scripts/release-audit.sh` |
| 命令 | `npm run release:audit` |
| 检查项 | 无绝对路径（macOS home 路径、Linux home 路径）、无硬编码 token、必需文件存在 |
| 失败含义 | 有安全或可移植性问题，不能发布 |

## 2.5 Bash 脚本测试（L1 变体）

| 项目 | 内容 |
|---|---|
| 框架 | `node:test` + bash subprocess（`spawn("bash", ["-c", "source script.sh; fn_name"])` ） |
| Mock 策略 | 在 tmpdir 内写 mock 可执行文件（如 `git`），通过 PATH 前置注入覆盖真实命令 |
| 环境隔离 | 测试通过 env 变量传入 `REPO_ROOT`、`MENGLAN_WORKTREE_ROOT` 等路径，指向 tmpdir |
| 典型范例 | `test/pandas-heartbeat.test.ts` TC-037（`_auto_worktree_clean` 的 mock-git 测试） |
| 适用场景 | harness.sh 新命令、pandas-heartbeat.sh 新函数；纯文档操作无需测试 |

---

## 3. 断言规范

### 3.1 运行时状态断言

| 项目 | 内容 |
|---|---|
| 规则 | 优先断言业务语义（健康状态、任务状态机、配置有效性），而非字符串字面量 |
| 应检查 | `status` 枚举值、`timestamp` 类型、`error` 字段存在性 |
| 不推荐 | 对完整 JSON 快照逐字断言（fragile，配置变更即失效）|

### 3.2 UI / HTTP 断言

| 项目 | 内容 |
|---|---|
| 规则 | 优先断言 HTTP 状态码、响应体关键字段 |
| 应检查 | 状态码、Content-Type、`status` 字段、错误格式 |
| 不推荐 | 断言完整 HTML 内容快照 |

---

## 4. 测试数据与 Fixture 规范

### 4.1 Fixture 目录结构

```
test/
  fixtures/
    openclaw/         # openclaw CLI stdout fixture（每个命令场景一个 JSON）
    sessions/         # 会话列表 fixture
```

### 4.2 命名约定

- 文件名体现命令 + 场景 + 成功/失败语义，例如：`openclaw/list-sessions-empty.json`
- fixture 必须可读，不使用难以维护的压缩快照

### 4.3 更新规则

- 修复产品逻辑后，先确认旧 fixture 是否仍代表目标行为
- 若更新 fixture，需在 PR 描述中说明"为什么旧 fixture 不再有效"

---

## 5. 运行门禁

### 5.1 本地开发（提 PR 前）

```bash
npm run release:audit   # L4：无绝对路径/token
npm run build           # L3：类型检查
npm test                # L1：单元测试
npm run smoke:ui        # L2：UI smoke（需 openclaw binary）
```

### 5.2 PR Gate（GitHub Actions 自动）

```bash
npm run release:audit   # L4
npm run build           # L3
npm test                # L1
bash scripts/check-req-coverage.sh  # REQ frontmatter 校验
```

> smoke:ui 不进 CI（见 2.2）。

---

## 6. 审查清单

### 自动可检查（脚本 / CI）

- [ ] `npm test` 通过，无 skip 或 fail
- [ ] `npm run build` 无 TypeScript 错误
- [ ] `npm run release:audit` 通过
- [ ] 新增测试目录 / 脚本已写入 `CLAUDE.md` 或文档

### 人工检查

- [ ] 测试分层合理，没有把单元测试写成集成测试
- [ ] mock 策略符合 §3.1
- [ ] fixture 可维护、可解释
- [ ] 失败后能快速判断是代码问题还是 fixture 过期

---

## 7. 验收标准

- **通过**：PR 默认测试全通过（release:audit + build + test）
- **打回**：
  - 任一 L1–L4 检查失败
  - 测试断言依赖不稳定的字符串快照
  - 新增关键逻辑没有对应测试

---

## 8. 速查词汇表

| 标准术语 | 含义 | 禁用同义词 |
|---|---|---|
| 单元测试 | 隔离单个模块/函数行为的 node:test 测试 | 小测试 |
| Smoke | 快速验证系统整体启动和基本路由可用 | 集成测试（不加说明时）|
| Mock | node:test 内置 mock.fn() 的受控替代 | 随机假数据 |
| Fixture | 固定可复现的测试样本 JSON | 临时数据 |

---

## 9. 变更日志

| 版本 | 日期 | 变更摘要 |
|---|---|---|
| 0.1 | 2026-03-15 | 初始版本；完整重写（从 hydro-om-copilot 改写）；删去 Playwright E2E、LLM Canary、Vitest、Python/FastAPI；改为 node:test + tsx；定义四层测试（L1–L4）；smoke:ui 不进 CI |
| 0.2 | 2026-03-16 | 多 Agent 扩展（REQ-027）：新增 §10 TC 所有权流转（Pandas→Huahua→Menglan 路径、打回规程、2 轮上限）|
| 0.3 | 2026-03-21 | worktree 隔离（REQ-037）：新增 §2.5 Bash 脚本 L1 测试——node:test 中 source 脚本、PATH 注入 mock git binary；以 test/pandas-heartbeat.test.ts TC-037 为范例 |
| 0.4 | 2026-03-28 | REQ-040 事后固化：新增 §10.7 tc-review 技术实现约束（TC 文件在 main 上而非 PR diff、TC 文件命名规范、prompt bash 注入防护、menglan worktree .env 要求）|

---

## 10. TC 所有权流转（多 Agent 协作路径）

> 本节适用于 `tc_policy=required` 且走多 Agent 协作路径的需求项。

### 10.1 标准流转路径

```
Pandas (orchestrate, status=ready)
  → Huahua (tc_design, owner=huahua, status=test_designed 后)
  → Menglan (tc_review, owner=menglan)
  → 通过: Menglan 开始实现 (owner=menglan, status=in_progress)
  → 打回: Huahua 重新设计 (owner=huahua, blocked_reason=review_rejected)
```

### 10.2 TC 设计阶段（Huahua 负责）

| 步骤 | 操作 |
|---|---|
| 1 | Pandas 通过 IPC 消息（`tc_design` 类型）将子 REQ spec 发给 Huahua |
| 2 | Huahua 在 `tasks/test-cases/` 创建 TC 文档，填入 REQ 的 `test_case_ref` |
| 3 | Huahua 更新 REQ：`status → test_designed`，`owner → huahua` |
| 4 | commit message：`tc-design: TC-xxx for REQ-xxx by huahua` |
| 5 | Huahua 发 IPC 消息（`tc_review` 类型）给 Menglan |

### 10.3 TC Review 阶段（Menglan 负责）

| 情况 | 操作 |
|---|---|
| 通过 | Menglan 更新 REQ：`status → in_progress`，`owner → menglan`；开始实现 |
| 打回 | Menglan 发 IPC 消息（`tc_blocked` 类型）给 Huahua，附打回原因及关联 Bug 链接（若有）；REQ：`status → blocked`，`blocked_reason: review_rejected`，`owner → menglan`（待 Huahua 认领修复），`review_round` 递增 |

### 10.4 TC Review 循环上限

- 最多 **2 轮** TC review 打回循环（`review_round <= 2`）
- 当 `review_round >= 2` 时，Menglan 须通过 `tg_decision` 升级 Daniel，不得继续打回

### 10.5 打回后修复流程（Huahua）

| 步骤 | 操作 |
|---|---|
| 1 | Huahua 收到 `tc_blocked` 消息后，claim REQ（`owner → huahua`，`status → in_progress`）|
| 2 | 修改 TC 文档，更新 `test_case_ref` |
| 3 | 更新 REQ：`status → test_designed`，`owner → huahua` |
| 4 | 重新发 `tc_review` 消息给 Menglan |

### 10.6 commit message 约定

| 场景 | commit message |
|---|---|
| TC 设计 | `tc-design: TC-xxx for REQ-xxx by huahua` |
| TC review 通过 | `tc-approved: TC-xxx REQ-xxx by menglan` |
| TC review 打回 | `tc-rejected: TC-xxx REQ-xxx by menglan (round N)` |
| TC 修复后重提 | `tc-revised: TC-xxx for REQ-xxx by huahua (round N)` |

### 10.7 tc-review 技术实现约束

**TC 文件存放位置与 PR diff 的关系**

TC 文件（`tasks/test-cases/TC-xxx-*.md`）在 `tc_design` 阶段由 Huahua 直接合入 `main`，
**不会出现在实现 PR 的 diff 里**。实现 PR 只包含代码变更。

`harness.sh tc-review` 因此必须从 `origin/main` 读取 TC 文件，而非从 PR diff 提取。
当前实现通过 `git ls-tree + git show origin/main:<path>` 加载对应 REQ 的全部 TC 文件，
并注入 prompt 的独立段落，明确告知 Claude "TC 文件在 main 上，PR diff 里看不到是预期行为"。

**TC 文件命名规范**

TC 文件名格式为 `TC-<NUM>-<seq>.md`（如 `TC-040-01.md`），其中 `<NUM>` 来自 REQ id 的数字部分。
不是 `REQ-040-01.md`。harness 根据 REQ id 提取数字后构造正确前缀（`TC-040-*`）。

**prompt 构造方式**

外部内容（REQ 文件、TC 文件、PR diff、review comments）可能包含 backtick。
若直接嵌入 bash double-quoted 字符串，backtick 会被 bash 当作命令替换执行。
正确做法：使用 `{ printf '%s\n' ... } > tmpfile` 写 prompt 到临时文件，
再以 stdin 重定向（`< tmpfile`）传给 claude，完全绕过 bash 字符串解析。

**Menglan worktree .env 要求**

`menglan-heartbeat.sh` 依赖 `SHARED_RESOURCES_ROOT` 确定 inbox 路径。
此变量从 `workspace-menglan/open-workhorse/.env` 加载。
worktree **不继承** pandas worktree 的 `.env`，需单独复制：

```bash
cp workspace-pandas/open-workhorse/.env workspace-menglan/open-workhorse/.env
```

缺少 `.env` 时 heartbeat 会使用错误的默认路径 `~/Dev/...`，静默退出，消息永远不被处理。
