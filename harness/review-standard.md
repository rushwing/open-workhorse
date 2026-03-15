---
harness_id: REV-STD-001
component: code review / PR quality
owner: Engineering
version: 0.1
status: stub
last_reviewed: 2026-03-15
---

# Harness Standard — 代码审查规程 [STUB]

> **当前状态：stub。** 已知原则已记录，可作为临时执行依据。
> 完整规程待 Daniel 在实际 review 中积累模式后补充。
> 本规程明确：`review` 的事实源是 GitHub PR，而不是 `tasks/`。

---

## 已确定原则

### Review Work Item 边界

- [ ] Review 工作项的事实源是 GitHub PR：reviewer、review comments、review decision、merge gate 都以 GitHub 为准
- [ ] 不在 `tasks/` 中重复维护 `review_claimed` / `review_done`
- [ ] repo 内只保留 review 规则与 checklist，不保留 review 状态机
- [ ] 若需要追踪 review 责任，优先使用 GitHub reviewer / assignee / labels

### PR 提交前（claude_code 自检）

- [ ] 本地测试全通过：`npm run release:audit && npm run build && npm test`
- [ ] `test_case_ref` 中所有 TC 对应测试通过
- [ ] 无遗留调试代码（`console.log` 临时调试）
- [ ] 无硬编码密钥、测试凭证或生产配置
- [ ] `tasks/features/REQ-xxx.md` 已更新为 `status: review`

### Review 关注点（Daniel / HITL）

**契约一致性**
- [ ] 实现与 REQ-xxx.md `Acceptance Criteria` 逐条对应
- [ ] TypeScript 类型正确，无 `any` 滥用
- [ ] API 路由与现有 UI 调用一致

**安全性**
- [ ] 无命令注入风险（execFile 参数验证）
- [ ] 无敏感数据写入日志或 HTTP 响应
- [ ] env 变量通过 `.env` 加载，不硬编码

**测试质量**
- [ ] 测试覆盖关键分支，不只是 happy path
- [ ] mock 策略符合 testing-standard.md §2.1

**代码可读性**
- [ ] 命名清晰，无缩写歧义
- [ ] 复杂逻辑有注释说明 why，而非 what

### HITL 合并条件

- [ ] CI 全部通过（release-audit + build + test + req-coverage）
- [ ] Daniel review 无 blocking comment
- [ ] PR merge 不允许自动化

---

## 待补充

- [ ] 正式 review checklist 模板（含评分标准）
- [ ] blocking vs non-blocking comment 区分规则
- [ ] 特殊场景处理：hotfix、文档 PR、依赖升级 PR
- [ ] review 时间 SLA

---

## 变更日志

| 版本 | 日期 | 变更摘要 |
|---|---|---|
| 0.1 | 2026-03-15 | 初始 stub（从 hydro-om-copilot REV-STD-001 改写）；删去 openai_codex reviewer；改为 Daniel HITL；更新 pre-commit 命令为 TypeScript 栈 |
