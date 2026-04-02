# Phase 1: Capability And Connector Registry

- Status: Complete
- Date: 2026-04-02
- Related:
  - [ADR 0001](../../adr/0001-agent-runtime-standardization.md)
  - [Migration Index](../migration-index.md)
  - [Phase 1 Before](../diagrams/agent-runtime-phase1-before.svg)
  - [Phase 1 After](../diagrams/agent-runtime-phase1-after.svg)

## Goal

Phase 1 turns `CAPABILITIES.md` and `CONNECTORS.md` into executable runtime contracts.

This phase does not replace the markdown docs.
It makes them loadable, verifiable, and consumable from Node.js so later phases can build mailbox, task lifecycle, and invocation policy on stable registry data instead of ad hoc parsing.

## Scope

Included:

- typed capability registry schema
- typed connector registry schema
- markdown spec-block loading from `harness/`
- canonical dot-format ids derived from legacy capability ids
- alias-based lookup so legacy names still resolve
- validation script and contract tests

Excluded:

- no capability renaming in `CAPABILITIES.md`
- no connector renaming in `CONNECTORS.md`
- no mailbox service implementation yet
- no task runtime yet
- no shell-script rewiring yet

## Naming Approach

Phase 1 keeps the existing harness naming as the canonical document-facing contract and introduces a runtime-facing canonical id alongside it.

Examples:

| Legacy id | Runtime canonical id |
| --- | --- |
| `ctx-request-read_human_intent` | `ctx.request.read_human_intent` |
| `workflow-task-transition_state` | `workflow.task.transition_state` |
| `agent-inbox-read_result_packet` | `agent.inbox.read_result_packet` |
| `notify-human-send_status_update` | `notify.human.send_status_update` |

Why this is the chosen seam:

- it preserves compatibility with `everything_openclaw`-linked harness docs
- it gives the runtime a more uniform lookup format
- it avoids a flag-day rename across prompts, scripts, and standards
- Phase 1 keeps one active connector binding per capability id; future fan-out must be an explicit design change

## Deliverables

| Deliverable | Description |
| --- | --- |
| `src/agent-runtime/capabilities/schema.ts` | capability types and canonical id helpers |
| `src/agent-runtime/capabilities/registry.ts` | capability markdown loader and registry |
| `src/agent-runtime/connectors/schema.ts` | connector types |
| `src/agent-runtime/connectors/registry.ts` | connector markdown loader and registry |
| `src/agent-runtime/shared/simple-yaml.ts` | minimal YAML subset parser for harness spec blocks |
| `scripts/validate-agent-runtime-registry.ts` | executable validation entrypoint |
| `test/agent-runtime-registry.test.ts` | contract coverage for loading and lookup |

## Acceptance Criteria

Phase 1 is considered complete when:

1. Node.js can load every capability spec block from `harness/CAPABILITIES.md`.
2. Node.js can load every connector spec block from `harness/CONNECTORS.md`.
3. Every connector resolves to an existing capability definition.
4. Legacy ids and canonical dot-format ids both resolve through the runtime registry.
5. A validation command exists for local and CI use.

## Follow-on Work

Phase 2 should build the mailbox service on top of these registries so inbox actions can reference capability and connector definitions instead of embedding workflow behavior directly in shell logic.
