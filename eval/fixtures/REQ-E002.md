---
req_id: REQ-E002
title: "Eval Fixture: Hello Script (tc_policy=required)"
status: review
priority: P3
phase: phase-9
owner: menglan
blocked_reason: ""
blocked_from_status: ""
blocked_from_owner: ""
depends_on: []
test_case_ref: [TC-E002-01]
tc_policy: required
tc_exempt_reason: ""
scope: scripts
acceptance: >
  A shell script at scripts/hello-e002.sh that prints "hello from REQ-E002" to stdout.
pending_bugs: []
pr_number: ""
review_round: 0
---

# REQ-E002: Hello Script (required TC fixture)

## Goal

Print "hello from REQ-E002" to stdout. This is a hello-world level fixture used
by the harness compliance eval suite to exercise the `tc_policy=required` path
(requires `test_designed` status before implementation begins).

## Acceptance Criteria

- `scripts/hello-e002.sh` exists and is executable
- Running it prints "hello from REQ-E002"

## Agent Notes

_Fixture task — do not implement unless running harness compliance eval._
