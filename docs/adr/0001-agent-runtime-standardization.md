# ADR 0001: Standardize the Agent Teams Runtime Around a Coordinator-Worker Kernel

- Status: Proposed
- Date: 2026-04-01
- Deciders: open-workhorse maintainers
- Related:
  - `harness/CAPABILITIES.md`
  - `harness/CONNECTORS.md`
  - `harness/inbox-protocol.md`
  - `scripts/pandas-heartbeat.sh`
  - `scripts/menglan-heartbeat.sh`
  - `scripts/huahua-heartbeat.sh`
  - `scripts/harness.sh`
  - `scripts/resident-worker.ts`
  - `scripts/resident-supervisor.ts`
  - `scripts/watchdog-orchestrator.ts`
  - `docs/architecture/migration-index.md`
  - `docs/architecture/phases/phase-0-boundary-freeze.md`

## Context

`open-workhorse` has two major layers:

1. A control-center UI/API for observing agents, tasks, approvals, budgets, and runtime state.
2. A `Harness Engineering + Agent Teams` runtime that actually coordinates software delivery through `Pandas`, `Huahua`, and `Menglan`.

The second layer is the real differentiator of the project.
It already contains several strong primitives:

- role-specialized agents
- markdown-backed work-item state machines
- file-backed inbox/message passing
- shell and Node supervision scripts
- worktree-based implementation isolation
- heartbeat, watchdog, and auto-heal flows

The weakness is not the core idea.
The weakness is that runtime policy and lifecycle are still spread across:

- prose contracts
- shell scripts
- markdown conventions
- runtime artifacts
- implicit operator knowledge

That makes the system harder to standardize, replay, test, and migrate from shell-heavy orchestration toward a stable Node.js runtime.

## Decision

We will treat `Harness Engineering + Agent Teams` as the architectural core of `open-workhorse` and evolve it into a standardized `Agent Runtime Kernel`.

The control center remains important, but it is a control plane over the runtime rather than the runtime itself.

This migration will be incremental.
We will not rewrite the system all at once.
We will preserve working shell paths while gradually moving coordination, mailbox handling, task lifecycle, resilience logic, and tool invocation into typed Node.js services.

## Borrowing Model

We may borrow architecture patterns from `fake-claude-code` and other public agent systems, but only at the level of ideas and engineering principles.

Allowed:

- coordinator/worker separation
- registry-driven capabilities and tools
- explicit task lifecycle models
- fail-closed permission and invocation gates
- checkpointing, replay, and recovery patterns
- context budgeting and graceful degradation

Not allowed:

- copying proprietary code
- mirroring private module boundaries or class names
- reusing prompts, rule tables, enums, or error text from non-open implementations
- producing a near-clone of any closed-source product surface

This ADR therefore governs an independent implementation, not a product imitation.

## Target Runtime Shape

The target runtime is organized into four planes:

```text
Agent Teams Operating Model
├─ control-plane
│  ├─ dashboard / api / replay / docs
│  └─ human approvals and operator decisions
├─ orchestration-plane
│  ├─ Pandas coordinator runtime
│  ├─ routing and reconciliation
│  └─ workflow state progression
├─ execution-plane
│  ├─ Menglan worker runtime
│  ├─ Huahua worker runtime
│  └─ task and invocation execution
└─ resilience-plane
   ├─ leases / locks
   ├─ heartbeats
   ├─ stall detection
   ├─ auto-heal
   └─ audit / replay / recovery evidence
```

The target code area will live under `src/agent-runtime/`.
Representative modules are expected to include:

- `kernel/`
- `capabilities/`
- `connectors/`
- `mailbox/`
- `coordinator/`
- `workers/`
- `resilience/`
- `observability/`

## Architecture Rules

The migration must preserve these long-lived rules:

1. `Pandas` is a coordinator, not a specialist executor.
2. `Huahua` and `Menglan` remain worker runtimes with bounded specialist roles.
3. `CAPABILITIES`, `CONNECTORS`, and `inbox-protocol` are kernel contracts, not just documentation.
4. High-risk writes stay fail-closed behind explicit policy and approval gates.
5. Replayability and auditability must improve with each phase.
6. Shell scripts may remain as adapters during migration, but they should stop being the long-term kernel.

## Migration Structure

This ADR is the umbrella decision and index.
Phase-level implementation detail lives under `docs/architecture/`.

Primary navigation:

- [Migration Index](../architecture/migration-index.md)
- [Phase 0: Boundary Freeze](../architecture/phases/phase-0-boundary-freeze.md)

Phase summary:

| Phase | Theme | Primary outcome |
| --- | --- | --- |
| 0 | Boundary freeze | Freeze runtime terminology, planes, contracts, and migration seams |
| 1 | Capability and connector registry | Make capability policy executable in Node.js |
| 2 | Mailbox service | Move inbox semantics out of ad hoc shell logic |
| 3 | Task runtime | Introduce typed task lifecycle and coordinator routing |
| 4 | Worker runtime | Lift worker business logic from shell into Node.js |
| 5 | Task-level resilience | Recover task instances, not only worker processes |
| 6 | Invocation pipeline | Standardize tool calls through one guarded path |
| 7 | Runtime observability | Expose runtime events, leases, and recovery to the control plane |

## Consequences

Positive:

- the project gets a clearer architectural center
- bash-to-Node refactoring gains a stable target shape
- future review and implementation work can align to explicit runtime seams
- recovery, replay, and observability become design goals instead of side effects

Costs:

- temporary duplication between shell and Node paths
- more up-front documentation and contract work
- a slower initial phase before major runtime code moves

## Review Trigger

Revisit this ADR when any of the following becomes true:

- the first machine-readable capability registry is merged
- the first production inbox path moves behind a mailbox service
- task-level lease recovery is introduced
- a fourth specialist agent is added
