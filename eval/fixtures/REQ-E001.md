---
req_id: REQ-E001
title: "Eval Fixture: Hello Script (tc_policy=exempt)"
status: review
priority: P3
phase: phase-9
owner: menglan
blocked_reason: ""
blocked_from_status: ""
blocked_from_owner: ""
depends_on: []
test_case_ref: []
tc_policy: exempt
tc_exempt_reason: "Hello-world fixture for harness compliance eval; no meaningful acceptance tests required"
scope: scripts
acceptance: >
  A shell script at scripts/hello-e001.sh that prints "hello from REQ-E001" to stdout.
pending_bugs: []
pr_number: ""
review_round: 0
---

# REQ-E001: Hello Script (exempt fixture)

## Goal

Print "hello from REQ-E001" to stdout. This is a hello-world level fixture used
by the harness compliance eval suite to exercise the `tc_policy=exempt` path
(direct `ready → in_progress` without a TC design step).

## Acceptance Criteria

- `scripts/hello-e001.sh` exists and is executable
- Running it prints "hello from REQ-E001"

## Agent Notes

_Fixture task — do not implement unless running harness compliance eval._
