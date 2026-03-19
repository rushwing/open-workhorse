---
doc_id: pandas-runbook-rendering-v0
purpose: How to render Pandas' RUNBOOK.md from the template and adapter files
load_when:
  - persona migration
  - deployment pipeline setup
  - project adapter authoring
avoid_loading_when:
  - active orchestration
owner: pandas_team
status: draft
---

# Pandas Runbook Rendering

This file explains how to use the runbook template safely during migration and deployment.

## Files

- `RUNBOOK.md`
  The semantic template and reusable orchestration contract.
- `RUNBOOK.adapter.yaml`
  The project-specific placeholder bindings.
- `RUNBOOK.adapter.schema.yaml`
  The validation contract for the adapter.

## Source Of Truth

- `RUNBOOK.md` is the semantic source of truth.
- `RUNBOOK.adapter.yaml` is the project-binding source of truth.
- The rendered deployment artifact is the runtime copy that the agent reads.

Do not hand-edit the rendered deployment artifact.

## Render Flow

1. Validate `RUNBOOK.adapter.yaml` against `RUNBOOK.adapter.schema.yaml`.
2. Parse placeholders from `RUNBOOK.md`.
3. Exclude reserved runtime tokens such as `REQ_ID`, `BUG_ID`, `PR_NUMBER`, and `RESULT_TYPE`.
4. Confirm every remaining placeholder has exactly one binding in `RUNBOOK.adapter.yaml`.
5. Render the final `RUNBOOK.md` into the deployed workspace path declared by `generated_output_path`.
6. Add generated metadata frontmatter so humans can trace which template and adapter produced the file.

## Deployment Guidance

- Run rendering during migration or deployment, not during active orchestration.
- Keep the rendered file in the agent workspace, for example `~/workspace-pandas/RUNBOOK.md`.
- Do not commit both the template and rendered file into the same project repo.
- If a project changes its commands or paths, update `RUNBOOK.adapter.yaml`, then re-render.

## Validation Checklist

- The adapter preserves Pandas' fixed identity fields.
- All required project-bound placeholders are bound.
- No unknown placeholders are present.
- Reserved runtime tokens are preserved instead of rendered away.
- Source keys such as `WORKER_STATUS_SOURCE` and `PR_METADATA_SOURCE` use allowed enum values.
- Rendered output path points to the deployed workspace.

## Notes

- Placeholder bindings may reference project wrappers and concrete commands.
- Capability choice and connector preference still belong in `RUNBOOK.md`.
- This keeps the orchestrator's reasoning contract stable even when project tooling changes.
