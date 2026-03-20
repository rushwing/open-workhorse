---
doc_id: pandas-connectors-v0
purpose: Runtime bindings for Pandas semantic capabilities in open-workhorse
load_when:
  - session start
  - request intake
  - packet dispatch
  - result reconciliation
avoid_loading_when:
  - pure persona writing
owner: pandas_team
status: draft
---

# Pandas Connectors

This file maps `Pandas`' semantic capabilities to concrete runtime bindings for the **open-workhorse** project.

`CAPABILITIES.md` says what Pandas can do.
`CONNECTORS.md` says how the current repo/runtime lets Pandas do it.

## Design Rules

- Keep capability names stable and repo-agnostic.
- Put implementation details in connector fields, not capability names.
- Prefer read-only observation before state mutation.
- Keep Pandas on metadata and workflow surfaces, not implementation diff surfaces.
- Use `backend + driver` pairs that are grep-friendly and field-stable.

## Fast Lookup

Use these patterns for quick search:

```bash
rg '^capability:' harness/CONNECTORS.md
rg 'backend: cli' harness/CONNECTORS.md
rg 'side_effect: remote_write' harness/CONNECTORS.md
rg 'approval_mode: human_required' harness/CONNECTORS.md
rg '^### `agent-' harness/CONNECTORS.md
```

## Identity

- agent: `Pandas`
- team_role: `engineering_orchestrator`
- system_role: `manager_agent`
- specialization: `workflow_orchestrator`
- implementer: `Meng Lan` (`delivery_engineer` / `specialist_agent` / `implementation_agent`)
- reviewer: `Hua Hua` (`quality_engineer` / `specialist_agent` / `review_evaluator_agent`)

## Connector Policy

- `Pandas` may read work items, worker status, result packets, and PR metadata.
- `Pandas` may write workflow state, packets, and curated shared memory.
- `Pandas` should not read PR diffs for review judgment.
- Remote-write connectors require explicit workflow need and, when user-facing, human approval.

## Master Index

| Capability | Backend | Driver | Side Effect | Approval | Purpose |
|---|---|---|---|---|---|
| `ctx-request-read_human_intent` | `agent` | `direct user message` | `none` | `none` | Read the incoming human request |
| `ctx-project-read_relevant_context` | `cli` | `rg, sed, cat-equivalent readers` | `none` | `none` | Read bounded routing context |
| `ctx-packet-assemble_retrieved_context` | `agent` | `structured markdown assembly` | `none` | `none` | Assemble packet-ready supporting context |
| `repo-files-read_work_items` | `cli` | `rg, sed, cat-equivalent readers` | `none` | `none` | Read REQ, BUG, TC, and harness docs |
| `repo-search-find_workflow_refs` | `cli` | `rg` | `none` | `none` | Discover linked work items and policy anchors |
| `workflow-task-claim_review_ready` | `cli` | `REQ frontmatter update` | `local_write` | `task_scoped` | Claim a new REQ into Pandas-controlled flow |
| `workflow-task-transition_state` | `cli` | `work item frontmatter update` | `local_write` | `task_scoped` | Advance REQ or BUG state lawfully |
| `workflow-bug-confirm_defect` | `cli` | `bug-state-machine + frontmatter update` | `local_write` | `task_scoped` | Confirm open bug into managed flow |
| `workflow-req-sync_bug_blocking` | `cli` | `REQ frontmatter sync` | `local_write` | `task_scoped` | Sync pending_bugs and blocked fields |
| `route-task-select_specialist` | `agent` | `structured routing policy` | `none` | `none` | Pick the next specialist target |
| `route-review-decide_required` | `agent` | `structured routing policy` | `none` | `none` | Decide whether review is mandatory |
| `route-result-decide_next_step` | `agent` | `structured routing policy` | `none` | `none` | Reconcile a result packet into the next action |
| `handoff-packet-compose_task` | `agent` | `structured markdown packet` | `none` | `none` | Compose a task packet for Meng Lan |
| `handoff-packet-compose_review` | `agent` | `structured markdown packet` | `none` | `none` | Compose a review packet for Hua Hua |
| `agent-inbox-write_task_packet` | `agent` | `shared inbox file` | `local_write` | `task_scoped` | Write a task packet to a worker inbox |
| `agent-inbox-write_review_packet` | `agent` | `shared inbox file` | `local_write` | `task_scoped` | Write a review packet to Hua Hua's inbox |
| `agent-inbox-read_result_packet` | `agent` | `shared inbox file` | `none` | `none` | Read specialist result packets |
| `agent-inbox-read_failure_signal` | `agent` | `shared inbox file` | `none` | `none` | Read specialist failure and blocked signals |
| `gh-pr-read_metadata` | `cli` | `gh pr view, gh run view` | `none` | `none` | Observe PR metadata and CI status |
| `mem-project-read_shared_memory` | `file` | `markdown` | `none` | `none` | Read curated shared project memory |
| `mem-project-write_shared_memory` | `file` | `markdown` | `local_write` | `task_scoped` | Write curated shared memory |
| `mem-project-curate_candidate` | `agent` | `result packet field + curation notes` | `local_write` | `task_scoped` | Normalize or reject memory candidates |
| `mem-longterm-query_knowledge` | `cli` | `sqlite3` | `none` | `none` | Query curated long-term knowledge from SQLite |
| `mem-longterm-write_knowledge` | `cli` | `sqlite3` | `local_write` | `task_scoped` | Persist accepted candidates into project.db (Pandas only) |
| `notify-human-send_status_update` | `cli` | `telegram.sh tg_pr_ready` | `remote_write` | `human_required` | Send user-facing status updates |
| `runtime-agent-read_worker_status` | `cli` | `heartbeat/status files` | `none` | `none` | Read worker idle or busy status |

## Connector Specs

### `ctx-request-read_human_intent`

```yaml
capability: ctx-request-read_human_intent
backend: agent
driver: direct user message
entrypoint: current conversation turn or orchestrator wakeup input
requires:
  - active incoming request
returns:
  - normalized orchestration intent
side_effect: none
approval_mode: none
notes:
  - this is the human-facing intake surface for Pandas
```

### `ctx-project-read_relevant_context`

```yaml
capability: ctx-project-read_relevant_context
backend: cli
driver: rg, sed, cat-equivalent readers
entrypoint: repo-local task docs, harness docs, or bounded project notes
requires:
  - readable repo workspace
returns:
  - bounded routing context
side_effect: none
approval_mode: none
notes:
  - prefer direct work item and harness docs over broad history loading
```

### `ctx-packet-assemble_retrieved_context`

```yaml
capability: ctx-packet-assemble_retrieved_context
backend: agent
driver: structured markdown assembly
entrypoint: task or review packet composition
requires:
  - selected work item facts
returns:
  - retrieved context block
side_effect: none
approval_mode: none
notes:
  - retrieved context should be minimal and target-specific
```

### `repo-files-read_work_items`

```yaml
capability: repo-files-read_work_items
backend: cli
driver: rg, sed, cat-equivalent readers
entrypoint: tasks/features, tasks/bugs, tasks/test-cases, tasks/phases, harness/
requires:
  - readable work item files
returns:
  - source excerpts
side_effect: none
approval_mode: none
notes:
  - Pandas reads work item docs and standards, not implementation diffs
```

### `repo-search-find_workflow_refs`

```yaml
capability: repo-search-find_workflow_refs
backend: cli
driver: rg
entrypoint: repo-wide workflow references
requires:
  - searchable repo workspace
returns:
  - linked references
side_effect: none
approval_mode: none
notes:
  - use for related_req, pending_bugs, tc refs, and policy anchors
```

### `workflow-task-claim_review_ready`

```yaml
capability: workflow-task-claim_review_ready
backend: cli
driver: REQ frontmatter update
entrypoint: tasks/features/REQ-*.md
requires:
  - REQ is in review_ready
  - claim is allowed by harness
returns:
  - req_review state with owner=pandas
side_effect: local_write
approval_mode: task_scoped
notes:
  - this is Pandas' first-hop claim into the pipeline
```

### `workflow-task-transition_state`

```yaml
capability: workflow-task-transition_state
backend: cli
driver: work item frontmatter update
entrypoint: tasks/features/REQ-*.md or tasks/bugs/BUG-*.md
requires:
  - valid target state
  - transition guard satisfied
returns:
  - updated state and required fields
side_effect: local_write
approval_mode: task_scoped
notes:
  - respect harness state authority, not ad-hoc agent states
```

### `workflow-bug-confirm_defect`

```yaml
capability: workflow-bug-confirm_defect
backend: cli
driver: bug-state-machine + frontmatter update
entrypoint: tasks/bugs/BUG-*.md
requires:
  - BUG status=open
returns:
  - BUG status=confirmed, owner=pandas
side_effect: local_write
approval_mode: task_scoped
notes:
  - first hop is always Pandas for bug confirmation
```

### `workflow-req-sync_bug_blocking`

```yaml
capability: workflow-req-sync_bug_blocking
backend: cli
driver: REQ frontmatter sync
entrypoint: linked REQ files
requires:
  - BUG with related_req
returns:
  - synced pending_bugs and blocked fields
side_effect: local_write
approval_mode: task_scoped
notes:
  - mirrors bug-standard blocking and unblock rules into REQ frontmatter
```

### `route-task-select_specialist`

```yaml
capability: route-task-select_specialist
backend: agent
driver: structured routing policy
entrypoint: intake classification or result reconciliation
requires:
  - current work item facts
returns:
  - next specialist target or explicit hold
side_effect: none
approval_mode: none
notes:
  - choose by role authority, bug_type route, and workflow stage
```

### `route-review-decide_required`

```yaml
capability: route-review-decide_required
backend: agent
driver: structured routing policy
entrypoint: result packet plus review trigger rules
requires:
  - specialist result packet
returns:
  - review required or not required decision
side_effect: none
approval_mode: none
notes:
  - use for mandatory review trigger evaluation
```

### `route-result-decide_next_step`

```yaml
capability: route-result-decide_next_step
backend: agent
driver: structured routing policy
entrypoint: result reconciliation step
requires:
  - specialist result packet
returns:
  - next orchestration action
side_effect: none
approval_mode: none
notes:
  - this is the semantic decision layer after results arrive
```

### `handoff-packet-compose_task`

```yaml
capability: handoff-packet-compose_task
backend: agent
driver: structured markdown packet
entrypoint: task dispatch preparation
requires:
  - selected work item facts
  - target specialist
returns:
  - task packet
side_effect: none
approval_mode: none
notes:
  - compose one bounded task packet per dispatch
```

### `handoff-packet-compose_review`

```yaml
capability: handoff-packet-compose_review
backend: agent
driver: structured markdown packet
entrypoint: review dispatch preparation
requires:
  - review target
  - review surface metadata
returns:
  - review packet
side_effect: none
approval_mode: none
notes:
  - Pandas prepares review scope without performing the review
```

### `agent-inbox-write_task_packet`

```yaml
capability: agent-inbox-write_task_packet
backend: agent
driver: shared inbox file
entrypoint: $SHARED_RESOURCES_ROOT/inbox/for-menglan/
requires:
  - complete task packet
  - SHARED_RESOURCES_ROOT env var set in .env
returns:
  - written inbox file (ATM Envelope format, type=request action=implement|bugfix|fix_review)
side_effect: local_write
approval_mode: task_scoped
notes:
  - write implementation or fix packets to Meng Lan's inbox via inbox_write_v2()
  - ATM Envelope schema: harness/inbox-protocol.md §2.1–2.2
  - SHARED_RESOURCES_ROOT defaults: see .env.example
```

### `agent-inbox-write_review_packet`

```yaml
capability: agent-inbox-write_review_packet
backend: agent
driver: shared inbox file
entrypoint: $SHARED_RESOURCES_ROOT/inbox/for-huahua/
requires:
  - complete review packet
  - SHARED_RESOURCES_ROOT env var set in .env
returns:
  - written inbox file (ATM Envelope format, type=request action=review)
side_effect: local_write
approval_mode: task_scoped
notes:
  - write review packets to Hua Hua's inbox via inbox_write_v2()
  - ATM Envelope schema: harness/inbox-protocol.md §2.1–2.2; action=review (canonical)
  - result packet from Huahua: type=response legacy_type=review_complete|review_blocked
```

### `agent-inbox-read_result_packet`

```yaml
capability: agent-inbox-read_result_packet
backend: agent
driver: shared inbox file
entrypoint: $SHARED_RESOURCES_ROOT/inbox/for-pandas/
requires:
  - readable Pandas inbox
  - SHARED_RESOURCES_ROOT env var set in .env
returns:
  - parsed result packet (ATM Envelope type=response + legacy_type subtype)
side_effect: none
approval_mode: none
notes:
  - specialist success paths return here; inbox_read_pandas() dispatches by legacy_type
  - ATM response routing: legacy_type=review_complete → _handle_review_complete;
    legacy_type=tc_complete → _handle_tc_complete; legacy_type=dev_complete → _handle_dev_complete
  - check for-pandas/ inbox before scanning task queue in each loop iteration
```

### `agent-inbox-read_failure_signal`

```yaml
capability: agent-inbox-read_failure_signal
backend: agent
driver: shared inbox file
entrypoint: $SHARED_RESOURCES_ROOT/inbox/for-pandas/
requires:
  - readable Pandas inbox
returns:
  - parsed failure or blocked signal
side_effect: none
approval_mode: none
notes:
  - heartbeat failure messages and blocked results return here
```

### `gh-pr-read_metadata`

```yaml
capability: gh-pr-read_metadata
backend: cli
driver: gh pr view, gh run view
entrypoint: GitHub PR metadata surfaces
requires:
  - authenticated gh cli
returns:
  - PR state, review state, and CI metadata
side_effect: none
approval_mode: none
notes:
  - do not use this connector to read or judge diff content
```

### `mem-project-read_shared_memory`

```yaml
capability: mem-project-read_shared_memory
backend: file
driver: markdown
entrypoint: ~/workspace-pandas/memory/
requires:
  - readable shared memory files
returns:
  - curated project memory
side_effect: none
approval_mode: none
notes:
  - shared memory is read-only for specialists and curated by Pandas
```

### `mem-project-write_shared_memory`

```yaml
capability: mem-project-write_shared_memory
backend: file
driver: markdown
entrypoint: ~/workspace-pandas/memory/
requires:
  - write authority
returns:
  - updated shared memory
side_effect: local_write
approval_mode: task_scoped
notes:
  - concrete memory schema defined in harness/memory-architecture.md
```

### `mem-project-curate_candidate`

```yaml
capability: mem-project-curate_candidate
backend: agent
driver: result packet field + curation notes
entrypoint: result reconciliation or daily curation pass
requires:
  - specialist memory candidate
returns:
  - accepted or rejected curation outcome
side_effect: local_write
approval_mode: task_scoped
notes:
  - curate first, write second
  - accepted candidates are persisted to project.db via mem-longterm-write_knowledge
```

### `mem-longterm-query_knowledge`

```yaml
capability: mem-longterm-query_knowledge
backend: cli
driver: sqlite3
entrypoint: sqlite3 $MEMORY_DB_PATH "SELECT ..."
requires:
  - project.db exists (initialized by npm run memory:init)
  - MEMORY_DB_PATH set in .env or defaults to ~/workspace-pandas/memory/long-term/project.db
returns:
  - query results as text
side_effect: none
approval_mode: none
notes:
  - Pandas uses this to check for existing entries before curation (deduplication)
  - write operations use mem-longterm-write_knowledge, not this capability
```

### `mem-longterm-write_knowledge`

```yaml
capability: mem-longterm-write_knowledge
backend: cli
driver: sqlite3
entrypoint: sqlite3 $MEMORY_DB_PATH "INSERT INTO ..."
requires:
  - project.db exists (created by npm run memory:init)
  - accepted curation record with target table and field values
returns:
  - inserted row id
side_effect: local_write
approval_mode: task_scoped
notes:
  - Pandas only — specialists must not call this connector
  - initialize project.db by running: npm run memory:init
  - always query first (mem-longterm-query_knowledge) before inserting to avoid duplicates
```

### `notify-human-send_status_update`

```yaml
capability: notify-human-send_status_update
backend: cli
driver: bash scripts/telegram.sh tg_pr_ready
entrypoint: bash scripts/telegram.sh tg_pr_ready '<pr_url>' '<summary>'
requires:
  - TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID set in .env
returns:
  - sent status update
side_effect: remote_write
approval_mode: human_required
notes:
  - use for merge-ready or blocked-status updates only when policy requires
  - see scripts/telegram.sh for configuration instructions
```

### `runtime-agent-read_worker_status`

```yaml
capability: runtime-agent-read_worker_status
backend: cli
driver: heartbeat/status files
entrypoint: runtime/last-snapshot.json
requires:
  - readable worker status files
returns:
  - worker idle or busy status plus heartbeat health
side_effect: none
approval_mode: none
notes:
  - Pandas uses this to time wakeups, not to override workflow guards
```

## Preferred Backend Order

1. Structured request and packet surfaces
2. Repo-local work item and harness reads
3. Repo-local workflow state writes
4. Shared inbox delivery surfaces
5. Remote GitHub metadata reads
6. Human-facing remote notifications

This ordering keeps Pandas grounded in workflow truth before external communication.
