# Agent Runtime Migration Index

This directory tracks the staged migration of `open-workhorse` from a shell-heavy agent harness into a standardized Node.js-centered `Agent Runtime Kernel`.

The umbrella architecture decision lives in [ADR 0001](../adr/0001-agent-runtime-standardization.md).
Phase documents hold the implementation detail, diagrams, scope, and acceptance criteria for each step.

## Document Map

| Document | Purpose |
| --- | --- |
| [ADR 0001](../adr/0001-agent-runtime-standardization.md) | Long-lived architecture decision and migration umbrella |
| [Phase 0](phases/phase-0-boundary-freeze.md) | Freeze terminology, boundaries, seams, and delivery rules |
| [Phase 1](phases/phase-1-capability-registry.md) | Executable capability and connector registry |
| `phases/phase-2-mailbox-service.md` | Planned: Node.js mailbox service |
| `phases/phase-3-task-runtime.md` | Planned: typed task lifecycle and coordinator runtime |
| `phases/phase-4-worker-runtime.md` | Planned: worker runtimes and shell thinning |
| `phases/phase-5-task-resilience.md` | Planned: task-level leases and recovery |
| `phases/phase-6-invocation-pipeline.md` | Planned: guarded tool invocation pipeline |
| `phases/phase-7-runtime-observability.md` | Planned: control-plane visibility into runtime internals |

## Phase Status

| Phase | Status | Focus | Notes |
| --- | --- | --- | --- |
| 0 | Complete | Boundary freeze and document structure | Delivered as docs-only groundwork with no runtime behavior change |
| 1 | In progress | Capability and connector registry | First material Node.js runtime contract |
| 2 | Planned | Mailbox service | Moves inbox parsing and claims into TS |
| 3 | Planned | Task runtime | Coordinator becomes state-driven, not branch-driven |
| 4 | Planned | Worker runtime | Shell scripts shrink to launchers/adapters |
| 5 | Planned | Task resilience | Stall handling upgrades from worker-level to task-level |
| 6 | Planned | Invocation pipeline | Side effects go through one guarded path |
| 7 | Planned | Observability | Dashboard reflects runtime events, not only end state |

## Migration Principles

1. Prefer strangler-style replacement over rewrite.
2. Keep shell entrypoints working while Node.js services take over core logic.
3. Preserve backward compatibility for existing inbox traffic until replacement paths are proven.
4. Treat `CAPABILITIES`, `CONNECTORS`, and `inbox-protocol` as canonical contracts.
5. Reference community best practices and implement the runtime in `open-workhorse` terms.

## Diagrams

Phase 0 comparison diagrams:

- [Before](diagrams/agent-runtime-phase0-before.svg)
- [After](diagrams/agent-runtime-phase0-after.svg)

Future phases should follow the same structure:

- `phaseX-before.svg`
- `phaseX-after.svg`
- one implementation note under `phases/`

Phase 1 comparison diagrams:

- [Before](diagrams/agent-runtime-phase1-before.svg)
- [After](diagrams/agent-runtime-phase1-after.svg)

## How To Use This Folder

- Start with [ADR 0001](../adr/0001-agent-runtime-standardization.md) for the long-lived decision.
- Read the current phase document for scope, acceptance criteria, and explicit non-goals.
- Use the paired diagrams during review to keep discussion on system shape, not only file movement.
- Keep implementation details out of the ADR unless they represent a durable architecture decision.
