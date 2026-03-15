---
harness_id: CI-STD-001
component: CI / quality gates / automation
owner: Engineering
version: 0.1
status: active
last_reviewed: 2026-03-15
---

# Harness Standard — CI 与质量门禁规程

> 适配 open-workhorse TypeScript/Node.js 技术栈。
> 四个 PR gate job：release-audit、build、test、req-coverage。
> smoke:ui 不进 CI（需真实 openclaw binary）。

---

## Pre-commit 检查（本地，开发者 / Claude Code 必跑）

```bash
npm run release:audit   # 检查绝对路径、硬编码 token、必需文件
npm run build           # TypeScript 编译检查
npm test                # node:test 单元测试
```

---

## PR Gate（合并前必须通过）

| 检查项 | 工具 | CI job |
|---|---|---|
| 发布门禁 | release-audit.sh | `release-audit` |
| TypeScript 构建 | tsc | `build` |
| 单元测试 | node:test + tsx | `test` |
| REQ 覆盖率 | check-req-coverage.sh | `req-coverage` |

> smoke:ui 需要真实 openclaw binary，**不进 CI**，仅作本地门禁。

---

## GitHub Actions（`.github/workflows/ci.yml`）

四个并行 job，全部 required：

```yaml
on:
  pull_request:
  push:
    branches: [main]
```

**job: release-audit** — `bash scripts/release-audit.sh`
**job: build** — `npm ci && npm run build`
**job: test** — `npm ci && npm test`
**job: req-coverage** — `bash scripts/check-req-coverage.sh`（空 tasks/ 时 gracefully pass）

完整配置见 `.github/workflows/ci.yml`。

---

## PR 配置

| 配置项 | 设置值 | 说明 |
|---|---|---|
| Implementation PR required reviews | 1 | Daniel（HITL）强制要求 |
| Allow auto-merge | 不需要 | 单 Agent 无自动认领场景 |

> 标题匹配 `^fix:` / `^feat:` / `^chore:` → 1 required human review（Daniel）。
> 无 auto-merge，所有 PR 需 Daniel approve。

---

## REQ 覆盖率门禁

### 目的

防止"REQ frontmatter 字段不完整就流转状态"和"TC 引用不存在的文件"两类问题。

### 脚本

```bash
bash scripts/check-req-coverage.sh   # 报告 + CI 模式（有缺口时 exit 1）
```

### 检查内容

- 所有 `tasks/features/REQ-*.md` frontmatter 字段完整
- `status` 值在允许枚举内
- `depends_on` 引用的 REQ 存在
- `status=test_designed` 时 `test_case_ref` 非空
- `test_case_ref` 中的 TC 文件存在于 `tasks/test-cases/`
- `status=in_progress` 时 `owner != unassigned`
- Orphan 检测：`tasks/test-cases/` 中没有 REQ 引用的 TC（孤儿 TC）

### 空目录行为

`tasks/features/` 为空时，脚本输出"no REQ files found, skipping"并以 exit 0 通过。

---

## 无定时构建

当前阶段不设 Daily / Weekly build。Phase 2 后根据需要评估接入。

---

## 变更日志

| 版本 | 日期 | 变更摘要 |
|---|---|---|
| 0.1 | 2026-03-15 | 初始版本（从 hydro-om-copilot CI-STD-001 重写）；删去 Python/FastAPI/Vitest/Playwright；改为四 job TypeScript CI；smoke:ui 不进 CI；无定时构建；无 auto-merge |
