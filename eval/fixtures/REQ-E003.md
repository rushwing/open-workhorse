---
req_id: REQ-E003
title: "Eval Fixture: Hello Script (blocked scenario)"
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
tc_exempt_reason: "Hello-world fixture for harness compliance eval; blocked scenario path"
scope: scripts
acceptance: >
  A shell script at scripts/hello-e003.sh that prints "hello from REQ-E003" to stdout.
pending_bugs: []
pr_number: ""
review_round: 0
---

# REQ-E003: Hello Script (blocked scenario fixture)

## Goal

Print "hello from REQ-E003" to stdout. This is a hello-world level fixture used
by the harness compliance eval suite to exercise the `blocked → unblocked → in_progress`
path (task was initially blocked, then unblocked before implementation).

## Acceptance Criteria

- `scripts/hello-e003.sh` exists and is executable
- Running it prints "hello from REQ-E003"

## Agent Notes

_Fixture task — do not implement unless running harness compliance eval._
