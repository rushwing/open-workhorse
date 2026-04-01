# Phase 0: Boundary Freeze

- Status: Complete
- Date: 2026-04-01
- Related:
  - [ADR 0001](../../adr/0001-agent-runtime-standardization.md)
  - [Migration Index](../migration-index.md)
  - [Before Diagram](../diagrams/agent-runtime-phase0-before.svg)
  - [After Diagram](../diagrams/agent-runtime-phase0-after.svg)

## Goal

Phase 0 does not migrate runtime behavior yet.
It freezes the target shape so later phases can move code without arguing about the architectural center each time.

This phase answers four questions:

1. What is the real core of the project?
2. Which planes and seams do we keep stable during migration?
3. How does the ongoing bash-to-Node.js refactor fit into the runtime plan?
4. Which documents become the durable source of truth?

## Before vs After

| Aspect | Before | After | Benefit | Estimated line change |
| --- | --- | --- | --- | ---: |
| Architectural center | Easy to read the repo as "UI + scripts" | Explicitly frames `Agent Teams Runtime` as the core and UI as control plane | Prevents UI-led refactors from distorting runtime design | 120-180 |
| Role boundary | `Pandas`, `Huahua`, `Menglan` behavior is distributed across scripts and docs | Formalizes coordinator, worker, resilience, and control planes | Cleaner ownership and better refactor seams | 60-100 |
| Contract status | `CAPABILITIES`, `CONNECTORS`, and inbox protocol are strong prose docs | Treats them as kernel contracts that future TS services must implement | Gives Phase 1-3 a stable foundation | 80-140 |
| bash to Node.js path | Refactor can feel like script-by-script translation | Refactor is anchored to runtime modules, not one-off rewrites | Avoids translating shell debt into TypeScript debt | 120-220 |
| Reviewability | Migration conversation is mostly verbal | ADR + migration index + phase note + before/after diagrams | Makes review cheaper and more objective | 300-450 |
| Phase 0 total | No durable migration frame | Stable documentation layout and decision trail | Lowers delivery risk for later phases | 680-1090 |

The line estimate is intentionally documentation-heavy.
Runtime code change during Phase 0 should stay near zero.

## Scope

Included:

- create a durable migration document structure
- define the four-plane runtime model
- define the coordinator/worker split as a long-lived rule
- map bash-to-Node.js work onto the phase plan
- publish phase diagrams for review

Excluded:

- no mailbox service implementation
- no capability registry implementation
- no task lifecycle code
- no worker runtime extraction
- no behavioral change to orchestration scripts

## Phase 0 Deliverables

| Deliverable | Description |
| --- | --- |
| `docs/adr/0001-agent-runtime-standardization.md` | Umbrella ADR and phase index |
| `docs/architecture/migration-index.md` | Navigation page for the staged migration |
| `docs/architecture/phases/phase-0-boundary-freeze.md` | This implementation note |
| `docs/architecture/diagrams/agent-runtime-phase0-before.svg` | Current-state structural view |
| `docs/architecture/diagrams/agent-runtime-phase0-after.svg` | Target framing after boundary freeze |

## Runtime Plan Frozen In This Phase

The migration is expected to proceed in this order:

1. Capability and connector registry
2. Mailbox service
3. Task runtime
4. Worker runtime
5. Task-level resilience
6. Invocation pipeline
7. Observability and replay surfaces

That order matters because it supports the bash-to-Node.js transition without a rewrite:

- first standardize contracts
- then move message handling
- then move lifecycle logic
- then thin shell workers
- then upgrade recovery and observability

## bash to Node.js Guidance

Phase 0 explicitly chooses a strangler pattern.

That means:

- shell entrypoints may stay in place for now
- new runtime logic should prefer TypeScript modules under `src/agent-runtime/`
- shell scripts should gradually become launchers/adapters instead of policy-heavy kernels
- no phase should require a flag day rewrite

Future phases should evaluate code movement against one question:

`Does this change reduce shell-owned business logic and move it toward the runtime kernel?`

If the answer is no, it is probably the wrong migration step.

## Acceptance Criteria

Phase 0 is complete when:

1. Reviewers can identify the runtime core, planes, and seams from the docs alone.
2. `ADR 0001` acts as the umbrella decision rather than a dumping ground for all detail.
3. Phase-specific implementation detail has a dedicated home under `docs/architecture/phases/`.
4. The bash-to-Node.js refactor is explicitly placed inside the same migration plan.
5. No runtime behavior changes are required to adopt the Phase 0 output.

## Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Over-documenting too early | Can stall delivery if docs drift from code | Keep Phase 0 focused on boundaries and links, not speculative internals |
| Treating shell as permanent | Makes later runtime extraction harder | State clearly that shell stays only as adapter during migration |
| Mixing implementation detail into ADR | Makes future review noisy | Keep ADR high-level and move detail into phase docs |

## Follow-on Work

The next implementation phase should create:

- `src/agent-runtime/capabilities/schema.ts`
- `src/agent-runtime/capabilities/registry.ts`
- `src/agent-runtime/connectors/registry.ts`
- validation and contract tests for registry loading

That will be documented under `phase-1-capability-registry.md`.
