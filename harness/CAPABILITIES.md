---
doc_id: pandas-capabilities-v0
purpose: Semantic capability contracts for Pandas
load_when:
  - session start
  - before request intake
  - before deciding how to route work
avoid_loading_when:
  - none
owner: pandas_team
status: draft
---

# Pandas Capabilities

This file defines what `Pandas` is allowed to do in semantic terms.

It does not define repo-specific implementation details. Concrete bindings
belong in `CONNECTORS.md`.

## Design Rules

- Capability names use `namespace-category-tool_name`.
- Names should describe orchestration intent, not implementation detail.
- Keep Pandas focused on routing, transition guards, packet assembly, state progression, and result reconciliation.
- Do not give Pandas specialist-only capabilities such as code implementation or diff review.
- Keep the capability surface small, composable, and grep-friendly.

## Naming Convention

```text
{namespace}-{category}-{tool_name}
```

Examples:

- `ctx-request-read_human_intent`
- `workflow-bug-confirm_defect`
- `route-task-select_specialist`
- `handoff-packet-compose_review`
- `agent-inbox-read_result_packet`
- `mem-project-curate_candidate`

## Namespace Guide

| Namespace | Use For |
|---|---|
| `ctx` | Request intake, context loading, and packet assembly support |
| `repo` | Repo-local reading for work items, harness docs, and project facts |
| `workflow` | Task-store state changes, bug confirmation, and workflow progression |
| `route` | Routing and next-step decision capabilities |
| `handoff` | Packet composition for specialist handoff |
| `agent` | Cross-agent inbox or packet delivery |
| `gh` | GitHub metadata and remote status observation |
| `mem` | Shared memory read and curation |
| `notify` | Human or system notifications |
| `runtime` | Worker status, locks, heartbeat, and runtime supervision |

Guidance:

- Use the generic namespace when the capability could exist in many repos.
- Use route/handoff to keep orchestration decisions separate from delivery mechanisms.
- Do not model specialist work as Pandas capabilities.

## Fast Lookup

Use these patterns for quick search:

```bash
rg '^capability:' harness/CAPABILITIES.md
rg 'family: route-\*' harness/CAPABILITIES.md
rg 'default_enabled: true' harness/CAPABILITIES.md
rg 'side_effect: remote_write' harness/CAPABILITIES.md
rg '^### `agent-' harness/CAPABILITIES.md
```

## Index

| Capability | Family | Default | Side Effect | Purpose |
|---|---|---:|---|---|
| `ctx-request-read_human_intent` | `ctx-*` | yes | `none` | Parse an incoming human request into orchestration intent |
| `ctx-project-read_relevant_context` | `ctx-*` | yes | `none` | Read only the project facts relevant to the current routing decision |
| `ctx-packet-assemble_retrieved_context` | `ctx-*` | yes | `none` | Assemble the minimal supporting context bundle for one packet |
| `repo-files-read_work_items` | `repo-*` | yes | `none` | Read REQ, BUG, TC, and harness docs before routing |
| `repo-search-find_workflow_refs` | `repo-*` | yes | `none` | Find related work items, workflow references, and policy anchors |
| `workflow-task-claim_review_ready` | `workflow-*` | no | `local_write` | Claim a `review_ready` REQ into Pandas-controlled flow |
| `workflow-task-transition_state` | `workflow-*` | no | `local_write` | Move a REQ or BUG through allowed workflow states |
| `workflow-bug-confirm_defect` | `workflow-*` | no | `local_write` | Confirm a newly opened BUG and hold it under Pandas authority |
| `workflow-req-sync_bug_blocking` | `workflow-*` | no | `local_write` | Apply or clear REQ blocking caused by linked BUG state |
| `route-task-select_specialist` | `route-*` | yes | `none` | Choose the next specialist owner for one bounded task |
| `route-review-decide_required` | `route-*` | yes | `none` | Decide whether Meng Lan output requires Hua Hua review |
| `route-result-decide_next_step` | `route-*` | yes | `none` | Decide the next workflow action after reading a result packet |
| `handoff-packet-compose_task` | `handoff-*` | yes | `none` | Compose a bounded implementation task packet for Meng Lan |
| `handoff-packet-compose_review` | `handoff-*` | yes | `none` | Compose a bounded review packet for Hua Hua |
| `agent-inbox-write_task_packet` | `agent-*` | yes | `local_write` | Deliver a task packet to a specialist inbox |
| `agent-inbox-write_review_packet` | `agent-*` | yes | `local_write` | Deliver a review packet to Hua Hua's inbox |
| `agent-inbox-read_result_packet` | `agent-*` | yes | `none` | Read result packets returned to Pandas |
| `agent-inbox-read_failure_signal` | `agent-*` | yes | `none` | Read worker failure alerts and blocked return messages |
| `gh-pr-read_metadata` | `gh-*` | no | `none` | Observe PR status, CI state, and review state without reading diffs |
| `mem-project-read_shared_memory` | `mem-*` | yes | `none` | Read existing shared project memory before routing or curating |
| `mem-project-write_shared_memory` | `mem-*` | no | `local_write` | Write curated shared project memory |
| `mem-project-curate_candidate` | `mem-*` | no | `local_write` | Accept, reject, or normalize memory candidates from specialists |
| `mem-longterm-query_knowledge` | `mem-*` | no | `none` | Query curated long-term knowledge from SQLite |
| `mem-longterm-write_knowledge` | `mem-*` | no | `local_write` | Write accepted candidates into project.db (Pandas only) |
| `notify-human-send_status_update` | `notify-*` | no | `remote_write` | Send a user-facing status update or merge-ready notice |
| `runtime-agent-read_worker_status` | `runtime-*` | yes | `none` | Read worker idle/busy state and runtime heartbeat data |
| `runtime-agent-send_keepalive` | `runtime-*` | no | `local_write` | 向停滞 agent inbox 发送 keep-alive implement 消息以触发恢复 |
| `runtime-harness-worktree_setup` | `runtime-*` | no | `local_write` | 为 Menglan 创建 git worktree（harness.sh implement 自动调用） |
| `runtime-harness-worktree_clean` | `runtime-*` | no | `local_write` | 移除 Menglan worktree（heartbeat 自动 或 手动 worktree-clean 调用） |

## Capability Specs

### `ctx-request-read_human_intent`

```yaml
capability: ctx-request-read_human_intent
family: ctx-*
default_enabled: true
side_effect: none
inputs:
  - human request
  - intake message
outputs:
  - routing-oriented request summary
use_when:
  - a new request arrives from Daniel
  - a follow-up needs reclassification
avoid_when:
  - the next step is already fully determined by a result packet
notes:
  - identify requested outcome, likely work item type, and ambiguity that must be resolved before dispatch
```

### `ctx-project-read_relevant_context`

```yaml
capability: ctx-project-read_relevant_context
family: ctx-*
default_enabled: true
side_effect: none
inputs:
  - relevant work items
  - project constraints
  - prior decisions
outputs:
  - bounded routing context
use_when:
  - routing needs project facts or state-machine anchors
avoid_when:
  - the urge is to load broad project history without clear routing need
notes:
  - read only enough context to make the next lawful routing decision
```

### `ctx-packet-assemble_retrieved_context`

```yaml
capability: ctx-packet-assemble_retrieved_context
family: ctx-*
default_enabled: true
side_effect: none
inputs:
  - selected work item facts
  - target specialist role
outputs:
  - retrieved context bundle
use_when:
  - Pandas is composing a task packet or review packet
avoid_when:
  - the task can be expressed clearly without extra supporting facts
notes:
  - assemble the minimum context that reduces ambiguity without flooding the specialist
```

### `repo-files-read_work_items`

```yaml
capability: repo-files-read_work_items
family: repo-*
default_enabled: true
side_effect: none
inputs:
  - REQ, BUG, TC, phase, or harness paths
outputs:
  - source excerpts
use_when:
  - routing or state progression depends on current work item facts
avoid_when:
  - the required fact already exists in the current packet or result packet
notes:
  - Pandas reads work item docs and harness rules, not implementation diffs
```

### `repo-search-find_workflow_refs`

```yaml
capability: repo-search-find_workflow_refs
family: repo-*
default_enabled: true
side_effect: none
inputs:
  - ids
  - symbols
  - workflow terms
outputs:
  - related references
use_when:
  - Pandas must locate linked REQ, BUG, TC, or policy references
avoid_when:
  - exact target files are already known and sufficient
notes:
  - use to discover dependency closure, bug links, or state-machine anchors
```

### `workflow-task-claim_review_ready`

```yaml
capability: workflow-task-claim_review_ready
family: workflow-*
default_enabled: false
side_effect: local_write
inputs:
  - REQ id
  - current review_ready state
  - owner identity
outputs:
  - req_review state owned by Pandas
use_when:
  - Pandas claims a new REQ from review_ready into the pipeline
avoid_when:
  - the REQ is not in review_ready
  - the REQ is already owned or already in downstream flow
notes:
  - this is the first orchestration claim, not specialist implementation claim
```

### `workflow-task-transition_state`

```yaml
capability: workflow-task-transition_state
family: workflow-*
default_enabled: false
side_effect: local_write
inputs:
  - work_item_id
  - target_state
  - allowed_transition_rules
outputs:
  - updated workflow state
use_when:
  - Pandas advances a REQ or BUG through an allowed transition
avoid_when:
  - the transition guard is unclear or unsatisfied
notes:
  - use only explicit harness states and record required guard evidence
  - for Pandas this means orchestration-owned transitions, not specialist claim or completion semantics
```

### `workflow-bug-confirm_defect`

```yaml
capability: workflow-bug-confirm_defect
family: workflow-*
default_enabled: false
side_effect: local_write
inputs:
  - bug_id
  - bug_type
  - open bug record
outputs:
  - confirmed bug owned by Pandas
use_when:
  - a newly opened bug enters the managed pipeline
avoid_when:
  - the bug is already confirmed or already claimed by a downstream specialist
notes:
  - first hop for all bug types is Pandas owning open->confirmed
```

### `workflow-req-sync_bug_blocking`

```yaml
capability: workflow-req-sync_bug_blocking
family: workflow-*
default_enabled: false
side_effect: local_write
inputs:
  - bug state
  - linked REQ ids
  - pending_bugs fields
outputs:
  - synchronized REQ blocking fields
use_when:
  - a linked bug should block or unblock a REQ
avoid_when:
  - the bug has no related_req
notes:
  - keep pending_bugs and blocked_from_* fields in sync with bug lifecycle rules
```

### `route-task-select_specialist`

```yaml
capability: route-task-select_specialist
family: route-*
default_enabled: true
side_effect: none
inputs:
  - work item facts
  - task type
  - bug_type or review need
outputs:
  - selected specialist target
use_when:
  - Pandas must choose Meng Lan, Hua Hua, or stay pending
avoid_when:
  - the next owner is already fixed by a direct returned result packet step
notes:
  - route by bounded role authority, not by who is likely to know the most context
```

### `route-review-decide_required`

```yaml
capability: route-review-decide_required
family: route-*
default_enabled: true
side_effect: none
inputs:
  - result packet
  - review trigger rules
outputs:
  - yes/no review requirement with reason
use_when:
  - Meng Lan returns work that may require Hua Hua review
avoid_when:
  - the task is already a review task or review is explicitly impossible
notes:
  - mandatory review is decided by policy, not by implementer preference
```

### `route-result-decide_next_step`

```yaml
capability: route-result-decide_next_step
family: route-*
default_enabled: true
side_effect: none
inputs:
  - result packet
  - current work item state
  - workflow guards
outputs:
  - next orchestration action
use_when:
  - a specialist result packet arrives
  - Pandas must decide whether to reroute, close, block, or escalate
avoid_when:
  - no new outcome exists to reconcile
notes:
  - route-result-decide_next_step is the semantic core of result reconciliation
```

### `handoff-packet-compose_task`

```yaml
capability: handoff-packet-compose_task
family: handoff-*
default_enabled: true
side_effect: none
inputs:
  - selected work item
  - target specialist
  - retrieved context
outputs:
  - task packet
use_when:
  - Pandas is dispatching bounded implementation or bug-fix work
avoid_when:
  - the task is actually a review packet
notes:
  - compose one clear goal, one authority boundary, and one completion contract
  - output becomes the payload_file for inbox_write_v2(); must satisfy ATM Envelope §2.1–2.2 (harness/inbox-protocol.md)
```

### `handoff-packet-compose_review`

```yaml
capability: handoff-packet-compose_review
family: handoff-*
default_enabled: true
side_effect: none
inputs:
  - selected review target
  - review surface metadata
  - retrieved context
outputs:
  - review packet
use_when:
  - Pandas is dispatching bounded review work to Hua Hua
avoid_when:
  - no review trigger has fired
notes:
  - include review surface, key risks, and expected verdict contract
  - output becomes the payload_file for inbox_write_v2() action=review; must satisfy ATM Envelope §2.1–2.2 (harness/inbox-protocol.md)
```

### `agent-inbox-write_task_packet`

```yaml
capability: agent-inbox-write_task_packet
family: agent-*
default_enabled: true
side_effect: local_write
inputs:
  - task packet
  - target specialist inbox
outputs:
  - written inbox message
use_when:
  - Pandas dispatches bounded work to Meng Lan or another worker-facing specialist
avoid_when:
  - the packet is incomplete or misrouted
notes:
  - writing the packet is delivery, not routing logic
  - must call inbox_write_v2() with type=request action=implement|bugfix|fix_review; schema: harness/inbox-protocol.md §2.1–2.2
```

### `agent-inbox-write_review_packet`

```yaml
capability: agent-inbox-write_review_packet
family: agent-*
default_enabled: true
side_effect: local_write
inputs:
  - review packet
  - Hua Hua inbox
outputs:
  - written review inbox message
use_when:
  - Pandas dispatches review work to Hua Hua
avoid_when:
  - review is not required or the packet lacks review surface metadata
notes:
  - use after route-review-decide_required and handoff-packet-compose_review
  - must call inbox_write_v2() with type=request action=review; schema: harness/inbox-protocol.md §2.1–2.2
```

### `agent-inbox-read_result_packet`

```yaml
capability: agent-inbox-read_result_packet
family: agent-*
default_enabled: true
side_effect: none
inputs:
  - Pandas inbox message
outputs:
  - parsed specialist result packet
use_when:
  - Pandas checks for completed specialist work
avoid_when:
  - no inbox result is present
notes:
  - read specialist results before making any state or routing decision
```

### `agent-inbox-read_failure_signal`

```yaml
capability: agent-inbox-read_failure_signal
family: agent-*
default_enabled: true
side_effect: none
inputs:
  - failure or blocked inbox message
outputs:
  - parsed failure signal
use_when:
  - a worker returns heartbeat failure or blocked execution notice
avoid_when:
  - the incoming message is a normal success result
notes:
  - failure signals should route to reconciliation and possible escalation, not to normal completion flow
```

### `gh-pr-read_metadata`

```yaml
capability: gh-pr-read_metadata
family: gh-*
default_enabled: false
side_effect: none
inputs:
  - pr number
outputs:
  - pr state, checks, and review metadata
use_when:
  - Pandas must observe PR/CI/review progress without inspecting the diff
avoid_when:
  - review surface inspection would contaminate orchestrator context
notes:
  - Pandas reads metadata only; diff review belongs to Hua Hua
```

### `mem-project-read_shared_memory`

```yaml
capability: mem-project-read_shared_memory
family: mem-*
default_enabled: true
side_effect: none
inputs:
  - shared memory paths
outputs:
  - curated project memory
use_when:
  - stable project facts are needed for routing or packet assembly
avoid_when:
  - direct work item facts already answer the question
notes:
  - memory accelerates routing but does not override current work item truth
```

### `mem-project-write_shared_memory`

```yaml
capability: mem-project-write_shared_memory
family: mem-*
default_enabled: false
side_effect: local_write
inputs:
  - curated durable memory entry
outputs:
  - updated shared project memory
use_when:
  - Pandas accepts a durable memory write
avoid_when:
  - the content is session-local, speculative, or not yet curated
notes:
  - Pandas is the shared-memory write authority; schema details are defined in harness/memory-architecture.md
```

### `mem-project-curate_candidate`

```yaml
capability: mem-project-curate_candidate
family: mem-*
default_enabled: false
side_effect: local_write
inputs:
  - memory candidate
  - current shared memory
outputs:
  - accepted, rejected, or normalized candidate
use_when:
  - a specialist proposes durable project memory
avoid_when:
  - the candidate is merely a session note or a still-unverified claim
notes:
  - curate before writing shared memory; do not auto-promote raw specialist notes
  - accepted candidates are persisted to project.db via mem-longterm-write_knowledge
```

### `mem-longterm-query_knowledge`

```yaml
capability: mem-longterm-query_knowledge
family: mem-*
default_enabled: false
side_effect: none
inputs:
  - topic or pattern type
  - SQL SELECT query
outputs:
  - matching rows from project_facts, decisions, patterns, or candidates
use_when:
  - checking for existing knowledge before curation (deduplication)
  - routing decisions benefit from prior pattern lookup
avoid_when:
  - the work item facts already answer the question
notes:
  - Pandas uses this to avoid duplicating accepted knowledge in project.db
  - write operations use mem-longterm-write_knowledge, not this capability
```

### `mem-longterm-write_knowledge`

```yaml
capability: mem-longterm-write_knowledge
family: mem-*
default_enabled: false
side_effect: local_write
inputs:
  - accepted curation record (topic, content, category)
  - target table (project_facts, decisions, patterns, or candidates)
outputs:
  - inserted row in project.db
use_when:
  - Pandas has evaluated a candidate and decided to accept it
  - a routing decision or review outcome warrants durable recording
avoid_when:
  - the candidate has not yet been evaluated (pending status)
  - the fact can be derived from the current work item without long-term storage
notes:
  - Pandas is the sole INSERT/UPDATE authority for project.db; specialists have SELECT only
  - always run mem-longterm-query_knowledge first to avoid duplicating accepted knowledge
```

### `notify-human-send_status_update`

```yaml
capability: notify-human-send_status_update
family: notify-*
default_enabled: false
side_effect: remote_write
inputs:
  - user-facing status summary
outputs:
  - sent notification
use_when:
  - Pandas must notify Daniel or another configured human channel
avoid_when:
  - no user-facing update is required
notes:
  - notification is downstream communication, not workflow authority
```

### `runtime-agent-read_worker_status`

```yaml
capability: runtime-agent-read_worker_status
family: runtime-*
default_enabled: true
side_effect: none
inputs:
  - worker status files
  - heartbeat snapshots
outputs:
  - idle or busy status plus runtime health hints
use_when:
  - Pandas must decide whether to wake a worker now or leave work queued
  - keep-alive watchdog evaluates whether an in_progress agent has stalled
avoid_when:
  - the next step does not depend on worker availability
notes:
  - worker availability informs dispatch timing, not task legality
  - timestamp files: runtime/menglan_alive.ts and runtime/huahua_alive.ts (written by each agent's heartbeat script)
  - stall threshold: AGENT_STALL_TIMEOUT_MINUTES env var (default 60 minutes)
  - if a timestamp file is absent or older than the threshold, the agent is considered stalled
```

### `runtime-agent-send_keepalive`

```yaml
capability: runtime-agent-send_keepalive
family: runtime-*
default_enabled: false
side_effect: local_write
inputs:
  - stalled agent id (menglan or huahua)
  - req_id of the in_progress task
  - optional branch_name (for single-PR rule path)
outputs:
  - keep-alive implement inbox message written to the agent's inbox
use_when:
  - _check_stall_and_keepalive() detects that an in_progress agent's alive timestamp has exceeded AGENT_STALL_TIMEOUT_MINUTES
avoid_when:
  - the agent's timestamp is fresh (stall not confirmed)
  - the REQ is not in in_progress status
notes:
  - called automatically by pandas-heartbeat.sh _check_stall_and_keepalive() on each tick
  - keep-alive message carries action=implement and, if a single-PR branch exists, branch_name=feat/<REQ-N>
  - does not change REQ state; recovery is the agent's responsibility on receiving the message
  - configurable via AGENT_STALL_TIMEOUT_MINUTES in .env (default 60)
```

### `runtime-harness-worktree_setup`

```yaml
capability: runtime-harness-worktree_setup
family: runtime-*
default_enabled: false
side_effect: local_write
inputs:
  - req_id（决定分支名 feat/<REQ-N>）
outputs:
  - MENGLAN_WORKTREE_ROOT 下的 git worktree，绑定到 feat/<REQ-N>
use_when:
  - Pandas 通过 harness.sh implement 派发实现任务给 Menglan 时
avoid_when:
  - 该 REQ 的 worktree 已存在且分支正确（幂等检查会跳过）
notes:
  - 由 cmd_worktree_setup() 在 harness.sh implement 内自动调用，Pandas 不直接调用
  - 分支基于 origin/main 创建，防止从调用方 HEAD 继承无关提交
  - 路径占用检查：若路径已存在但分支不匹配，exit 1 并提示先 worktree-clean
```

### `runtime-harness-worktree_clean`

```yaml
capability: runtime-harness-worktree_clean
family: runtime-*
default_enabled: false
side_effect: local_write
inputs:
  - req_id（用于校验挂载分支是否匹配 feat/<REQ-N>）
outputs:
  - MENGLAN_WORKTREE_ROOT 下的 worktree 移除；不存在时静默跳过
use_when:
  - REQ 达到 status=done 后（heartbeat 自动执行）
  - 手动清理：harness.sh worktree-clean <REQ-N>
avoid_when:
  - 挂载分支与请求的 REQ-N 不符（会拒绝操作，防止跨任务误删）
notes:
  - 主路径：pandas-heartbeat.sh _auto_worktree_clean() 在每次心跳检测 status=done 后自动触发
  - 手动路径：harness.sh worktree-clean <REQ-N>（会先校验分支匹配）
```
