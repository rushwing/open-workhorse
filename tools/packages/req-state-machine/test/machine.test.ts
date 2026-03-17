// L1 tests for req-state-machine — covers TC-030-01 through TC-030-12

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGAL_TRANSITIONS,
  validateTransition,
  applyTransition,
  block,
  unblock,
  validateReqFields,
  IllegalTransitionError,
} from '../src/index.js';
import type { ReqFrontmatter } from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<ReqFrontmatter> = {}): ReqFrontmatter {
  return {
    req_id: 'REQ-001',
    title: 'Test requirement',
    status: 'draft',
    priority: 'P1',
    phase: 'phase-1',
    owner: 'unassigned',
    blocked_reason: undefined,
    blocked_from_status: undefined,
    blocked_from_owner: undefined,
    review_round: 0,
    depends_on: [],
    test_case_ref: ['TC-001'],
    tc_policy: 'required',
    tc_exempt_reason: '',
    scope: 'runtime',
    acceptance: 'test',
    pending_bugs: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// GROUP A — Happy paths (TC-030-01 ~ 03)
// ---------------------------------------------------------------------------

describe('Group A — happy paths', () => {
  test('TC-030-01: full main path draft → done', () => {
    const req = makeReq();

    applyTransition(req, 'review_ready');
    assert.equal(req.status, 'review_ready');

    applyTransition(req, 'req_review');
    assert.equal(req.status, 'req_review');
    assert.equal(req.owner, 'huahua');

    applyTransition(req, 'ready');
    assert.equal(req.status, 'ready');
    assert.equal(req.owner, 'huahua');

    applyTransition(req, 'test_designed');
    assert.equal(req.status, 'test_designed');
    assert.equal(req.owner, 'huahua');

    applyTransition(req, 'in_progress');
    assert.equal(req.status, 'in_progress');
    assert.equal(req.owner, 'claude_code');

    applyTransition(req, 'review');
    assert.equal(req.status, 'review');

    applyTransition(req, 'done');
    assert.equal(req.status, 'done');
    assert.equal(req.owner, 'unassigned');
  });

  test('TC-030-02: folded path req_review → test_designed (Huahua merges TC design)', () => {
    const req = makeReq({ status: 'req_review', owner: 'huahua' });

    applyTransition(req, 'test_designed');
    assert.equal(req.status, 'test_designed');
    assert.equal(req.owner, 'huahua');
  });

  test('TC-030-03: tc_policy=optional skip — ready → in_progress allowed', () => {
    const req = makeReq({ status: 'ready', tc_policy: 'optional', owner: 'huahua' });

    applyTransition(req, 'in_progress');
    assert.equal(req.status, 'in_progress');
    assert.equal(req.owner, 'claude_code');
  });
});

// ---------------------------------------------------------------------------
// GROUP B — State-as-lock (TC-030-04 ~ 05)
// ---------------------------------------------------------------------------

describe('Group B — state-as-lock', () => {
  test('TC-030-04: review_ready → req_review assigns owner=huahua', () => {
    const req = makeReq({ status: 'review_ready', owner: 'unassigned' });

    applyTransition(req, 'req_review');
    assert.equal(req.status, 'req_review');
    assert.equal(req.owner, 'huahua');
  });

  test('TC-030-05: review → blocked increments review_round; review_round>=2 triggers tgNotify', () => {
    const req = makeReq({ status: 'review', owner: 'claude_code', review_round: 0 });
    const notified: string[] = [];
    const tgNotify = (msg: string) => notified.push(msg);

    // First review rejection (review_round becomes 1, no notify)
    applyTransition(req, 'blocked', { blockedReason: 'review_rejected', tgNotify });
    assert.equal(req.status, 'blocked');
    assert.equal(req.review_round, 1);
    assert.equal(req.blocked_reason, 'review_rejected', 'blocked_reason must be set');
    assert.equal(req.blocked_from_status, 'review', 'blocked_from_status must be set');
    // review_rejected is not bug_linked — owner must NOT be cleared
    assert.equal(req.owner, 'claude_code', 'owner must not be cleared for non-bug_linked block');
    assert.equal(notified.length, 0, 'no notify at review_round=1');

    // Restore to review (clear blocked fields)
    req.status = 'review';
    delete req.blocked_from_status;
    delete req.blocked_reason;

    // Second review rejection (review_round becomes 2, should notify)
    applyTransition(req, 'blocked', { blockedReason: 'review_rejected', tgNotify });
    assert.equal(req.review_round, 2);
    assert.ok(notified.length >= 1, 'tgNotify must be called at review_round=2');
  });
});

// ---------------------------------------------------------------------------
// GROUP C — block/unblock (TC-030-06 ~ 07)
// ---------------------------------------------------------------------------

describe('Group C — block/unblock', () => {
  test('TC-030-06: block(req, bug_linked) saves blocked_from_owner; unblock restores owner', () => {
    const req = makeReq({ status: 'in_progress', owner: 'claude_code' });

    block(req, 'bug_linked');
    assert.equal(req.status, 'blocked');
    assert.equal(req.blocked_reason, 'bug_linked');
    assert.equal(req.blocked_from_status, 'in_progress');
    assert.equal(req.blocked_from_owner, 'claude_code', 'blocked_from_owner must be saved');
    assert.equal(req.owner, 'unassigned', 'owner must be cleared on block');

    unblock(req);
    assert.equal(req.status, 'in_progress');
    assert.equal(req.owner, 'claude_code', 'owner must be restored from blocked_from_owner');
    assert.equal(req.blocked_reason, undefined, 'blocked_reason must be cleared');
    assert.equal(req.blocked_from_status, undefined, 'blocked_from_status must be cleared');
    assert.equal(req.blocked_from_owner, undefined, 'blocked_from_owner must be cleared');
  });

  test('TC-030-07: block(req, dep_not_done) — no blocked_from_owner; owner unchanged throughout', () => {
    const req = makeReq({ status: 'test_designed', owner: 'huahua' });

    block(req, 'dep_not_done');
    assert.equal(req.status, 'blocked');
    assert.equal(req.blocked_reason, 'dep_not_done');
    assert.equal(req.blocked_from_status, 'test_designed');
    assert.equal(req.blocked_from_owner, undefined, 'no blocked_from_owner for non-bug_linked');
    // dep_not_done does NOT clear owner (only bug_linked does per §6.2)
    assert.equal(req.owner, 'huahua', 'owner must not be cleared for non-bug_linked block');

    unblock(req);
    assert.equal(req.status, 'test_designed');
    assert.equal(req.owner, 'huahua', 'owner preserved throughout');
    assert.equal(req.blocked_reason, undefined);
    assert.equal(req.blocked_from_status, undefined);
  });
});

// ---------------------------------------------------------------------------
// GROUP D — Illegal transitions (TC-030-08 ~ 11)
// ---------------------------------------------------------------------------

describe('Group D — illegal transitions', () => {
  test('TC-030-08: draft → req_review is rejected', () => {
    const result = validateTransition('draft', 'req_review');
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('draft'));
  });

  test('TC-030-09: blocked → done is rejected (must unblock first)', () => {
    const result = validateTransition('blocked', 'done');
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('blocked'));

    // Also via applyTransition
    const req = makeReq({ status: 'blocked', blocked_from_status: 'review' });
    assert.throws(
      () => applyTransition(req, 'done'),
      (err: unknown) => {
        assert.ok(err instanceof IllegalTransitionError);
        return true;
      },
    );
  });

  test('TC-030-10: ready → in_progress rejected when tc_policy=required', () => {
    const req = makeReq({ status: 'ready', tc_policy: 'required', owner: 'huahua' });

    assert.throws(
      () => applyTransition(req, 'in_progress'),
      (err: unknown) => {
        assert.ok(err instanceof IllegalTransitionError);
        assert.ok((err as IllegalTransitionError).message.includes('tc_policy=required'));
        return true;
      },
    );
    // Status unchanged
    assert.equal(req.status, 'ready');
  });

  test('applyTransition → blocked without blockedReason throws (P1 contract)', () => {
    const req = makeReq({ status: 'in_progress', owner: 'claude_code' });

    assert.throws(
      () => applyTransition(req, 'blocked'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok((err as Error).message.includes('blockedReason'));
        return true;
      },
    );
    assert.equal(req.status, 'in_progress', 'status must not change on throw');
  });

  test('TC-030-11: review → done rejected when pending_bugs is non-empty', () => {
    const req = makeReq({
      status: 'review',
      owner: 'claude_code',
      pending_bugs: ['BUG-001'],
    });

    assert.throws(
      () => applyTransition(req, 'done'),
      (err: unknown) => {
        assert.ok(err instanceof IllegalTransitionError);
        assert.ok((err as IllegalTransitionError).message.includes('pending_bugs'));
        return true;
      },
    );
    // Status unchanged
    assert.equal(req.status, 'review');
  });
});

// ---------------------------------------------------------------------------
// GROUP E — Field validation (TC-030-12)
// ---------------------------------------------------------------------------

describe('Group E — field validation', () => {
  test('TC-030-12: validateReqFields catches multiple violation types', () => {
    // (a) blocked missing blocked_reason
    const e1 = validateReqFields({ status: 'blocked', blocked_reason: '', blocked_from_status: 'in_progress' });
    const brErr = e1.find(e => e.field === 'blocked_reason');
    assert.ok(brErr, 'should have a blocked_reason error');
    assert.match(brErr.message, /blocked_reason.*required.*blocked/i);

    // (b) in_progress with owner=unassigned
    const e2 = validateReqFields({ status: 'in_progress', owner: 'unassigned' });
    const ownerErr = e2.find(e => e.field === 'owner');
    assert.ok(ownerErr, 'should have an owner error');
    assert.match(ownerErr.message, /unassigned.*in_progress/i);

    // (c) bug_linked missing blocked_from_owner
    const e3 = validateReqFields({
      status: 'blocked',
      blocked_reason: 'bug_linked',
      blocked_from_status: 'in_progress',
      blocked_from_owner: '',
    });
    const bfoErr = e3.find(e => e.field === 'blocked_from_owner');
    assert.ok(bfoErr, 'should have a blocked_from_owner error');
    assert.match(bfoErr.message, /blocked_from_owner.*required.*bug_linked/i);

    // (d) valid blocked with all fields — no errors
    const e4 = validateReqFields({
      status: 'blocked',
      blocked_reason: 'dep_not_done',
      blocked_from_status: 'ready',
    });
    assert.equal(e4.length, 0, 'valid blocked req should have no errors');

    // (e) valid in_progress with named owner — no errors
    const e5 = validateReqFields({ status: 'in_progress', owner: 'claude_code' });
    assert.equal(e5.length, 0, 'valid in_progress req should have no errors');
  });
});

// ---------------------------------------------------------------------------
// Configurable agent names (P2a coverage)
// ---------------------------------------------------------------------------

describe('Configurable agent names', () => {
  test('reviewerAgent option overrides default huahua', () => {
    const req = makeReq({ status: 'review_ready', owner: 'unassigned' });

    applyTransition(req, 'req_review', { reviewerAgent: 'custom_reviewer' });
    assert.equal(req.owner, 'custom_reviewer');
  });

  test('implementerAgent option overrides default claude_code', () => {
    const req = makeReq({ status: 'test_designed', owner: 'huahua', tc_policy: 'required' });

    applyTransition(req, 'in_progress', { implementerAgent: 'custom_coder' });
    assert.equal(req.owner, 'custom_coder');
  });
});

// ---------------------------------------------------------------------------
// Sanity: LEGAL_TRANSITIONS table integrity
// ---------------------------------------------------------------------------

describe('LEGAL_TRANSITIONS table', () => {
  test('all 9 states are present as keys', () => {
    const states = [
      'draft', 'review_ready', 'req_review', 'ready', 'test_designed',
      'in_progress', 'review', 'blocked', 'done',
    ];
    for (const s of states) {
      assert.ok(s in LEGAL_TRANSITIONS, `${s} should be a key in LEGAL_TRANSITIONS`);
    }
  });

  test('terminal states (done, blocked) have no outgoing transitions', () => {
    assert.deepEqual(LEGAL_TRANSITIONS['done'], []);
    assert.deepEqual(LEGAL_TRANSITIONS['blocked'], []);
  });
});
