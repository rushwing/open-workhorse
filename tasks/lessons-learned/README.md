# Lessons Learned

本目录存放每次重要 Bug 修复后提取的经验教训文档。

## 写入时机

以下条件之一满足时，Bug closed 后必须创建 LL 文档（见 `harness/bug-standard.md` §9）：

- S1 / S2 级 Bug
- `review_round >= 2` 的任意 Bug
- `bug_type = user_bug`（无论严重等级）
- `blocked` 状态持续超过 48 小时的 Bug

## 命名规则

```
LL-001.md
LL-002.md
...
```

序号从 001 开始递增，不复用。

## 文档模板

```md
---
ll_id: LL-001
related_bug: BUG-xxx
bug_type: impl_bug
severity: S2
closed_date: YYYY-MM-DD
author: menglan  # 或 huahua，即 fix 责任人
---

# 问题摘要

> 一句话描述这次 Bug 的本质

# 根因

> 为什么会发生？定位到具体机制或认知盲点

# 修复过程复盘

> 修复路径是否最优？哪些步骤浪费了时间？

# 可避免性分析

> 这个 Bug 是否可以在更早阶段发现？如何？

# 改进措施

> 具体的、可执行的改进建议（流程、测试、规范）

# 后续追踪

> 改进措施是否已落地？落地在哪个 REQ/TC/文档？
```

## 引用关系

每个 LL 文档由对应 Bug 的 `Agent Notes` 中的 `## Lesson Learned` 节引用：

```
## Lesson Learned
- LL-xxx: tasks/lessons-learned/LL-xxx.md
```
