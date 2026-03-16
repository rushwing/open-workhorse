// L1 tests for bug-state-machine — covers TC-028-01 through TC-028-24
// Group C (TC-028-10~13, 21~22): GitHub sync tests — deferred (need GhSyncService)
// All other groups: fully implemented

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGAL_TRANSITIONS,
  validateTransition,
  applyTransition,
  block,
  unblock,
  validateBugFields,
  IllegalTransitionError,
} from '../src/index.js';
import type {
  BugFrontmatter,
  ReqFrontmatter,
  GhClient,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBug(overrides: Partial<BugFrontmatter> = {}): BugFrontmatter {
  return {
    bug_id: 'BUG-001',
    bug_type: 'impl_bug',
    title: 'Test bug',
    status: 'open',
    severity: 'S2',
    priority: 'P1',
    owner: 'unassigned',
    related_req: [],
    related_tc: [],
    tc_policy: 'required',
    tc_exempt_reason: '',
    reported_by: 'pandas',
    review_round: 0,
    depends_on: [],
    github_issue: '',
    regressing_notified: false,
    regressing_notified_at: '',
    ...overrides,
  };
}

function makeGhMock(overrides: Partial<GhClient> = {}): GhClient {
  return {
    issueView: async () => ({ state: 'OPEN' }),
    issueComment: async () => {},
    issueClose: async () => {},
    issueAddLabel: async () => {},
    issueRemoveLabel: async () => {},
    issueList: async () => [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// GROUP A — Internal bug happy paths (TC-028-01 ~ 04)
// ---------------------------------------------------------------------------

describe('Group A — internal bug happy paths', () => {
  test('TC-028-01: req_bug full path with REQ blocking/unblocking', async () => {
    const bug = makeBug({ bug_type: 'req_bug', status: 'open', related_req: ['REQ-001'] });
    const reqs: Record<string, ReqFrontmatter> = {
      'REQ-001': { status: 'req_review' },
    };

    // Step 2: open → confirmed
    await applyTransition(bug, 'confirmed', { relatedReqs: reqs });
    assert.equal(bug.status, 'confirmed');
    assert.equal(bug.owner, 'pandas');

    // Step 3: REQ is blocked
    assert.equal(reqs['REQ-001'].status, 'blocked');
    assert.equal(reqs['REQ-001'].blocked_reason, 'bug_linked');
    assert.equal(reqs['REQ-001'].blocked_from_status, 'req_review');

    // Step 4: confirmed → in_progress
    await applyTransition(bug, 'in_progress', { relatedReqs: reqs });
    assert.equal(bug.owner, 'menglan');

    // Step 5: in_progress → fixed
    await applyTransition(bug, 'fixed', { relatedReqs: reqs });
    assert.equal(bug.status, 'fixed');

    // Step 6: fixed → regressing
    await applyTransition(bug, 'regressing', { relatedReqs: reqs });
    assert.equal(bug.status, 'regressing');

    // Step 7: regressing → closed
    await applyTransition(bug, 'closed', { relatedReqs: reqs });
    assert.equal(bug.status, 'closed');

    // Steps 8–10: REQ unblocked
    assert.equal(reqs['REQ-001'].status, 'req_review');
    assert.equal(reqs['REQ-001'].blocked_reason, undefined);
    assert.equal(reqs['REQ-001'].blocked_from_status, undefined);
  });

  test('TC-028-02: tc_bug full path — fix owner=huahua, reviewer=menglan', async () => {
    const bug = makeBug({ bug_type: 'tc_bug', status: 'open', related_req: ['REQ-001'] });
    const reqs: Record<string, ReqFrontmatter> = {
      'REQ-001': { status: 'ready' },
    };

    // open → confirmed
    await applyTransition(bug, 'confirmed', { relatedReqs: reqs });
    assert.equal(bug.status, 'confirmed');
    assert.equal(bug.owner, 'pandas');
    assert.equal(reqs['REQ-001'].status, 'blocked');
    assert.equal(reqs['REQ-001'].blocked_from_status, 'ready');

    // confirmed → in_progress: tc_bug fix owner = huahua, reviewer = menglan
    await applyTransition(bug, 'in_progress', { relatedReqs: reqs });
    assert.equal(bug.owner, 'huahua');
    assert.equal(bug.reviewer, 'menglan');

    // in_progress → fixed → regressing → closed
    await applyTransition(bug, 'fixed');
    await applyTransition(bug, 'regressing');
    await applyTransition(bug, 'closed', { relatedReqs: reqs });
    assert.equal(bug.status, 'closed');

    // REQ restored to blocked_from_status=ready
    assert.equal(reqs['REQ-001'].status, 'ready');
    assert.equal(reqs['REQ-001'].blocked_reason, undefined);
  });

  test('TC-028-03: impl_bug full path — fix owner=menglan, REQ from in_progress', async () => {
    const bug = makeBug({ bug_type: 'impl_bug', status: 'open', related_req: ['REQ-001'] });
    const reqs: Record<string, ReqFrontmatter> = {
      'REQ-001': { status: 'in_progress' },
    };

    await applyTransition(bug, 'confirmed', { relatedReqs: reqs });
    assert.equal(reqs['REQ-001'].blocked_from_status, 'in_progress');

    await applyTransition(bug, 'in_progress');
    assert.equal(bug.owner, 'menglan');

    await applyTransition(bug, 'fixed');
    await applyTransition(bug, 'regressing');
    await applyTransition(bug, 'closed', { relatedReqs: reqs });
    assert.equal(bug.status, 'closed');

    // REQ restored to in_progress (not req_review or any other state)
    assert.equal(reqs['REQ-001'].status, 'in_progress');
    assert.equal(reqs['REQ-001'].blocked_reason, undefined);
  });

  test('TC-028-04: ci_bug full path — REQ from review state, fix owner=menglan', async () => {
    const bug = makeBug({ bug_type: 'ci_bug', status: 'open', related_req: ['REQ-001'] });
    const reqs: Record<string, ReqFrontmatter> = {
      // ci_bug triggers when REQ is at 'review' (CI stage), NOT req_review
      'REQ-001': { status: 'review' },
    };

    // Automatic confirmation by pandas
    await applyTransition(bug, 'confirmed', { relatedReqs: reqs });
    assert.equal(bug.status, 'confirmed');
    assert.equal(bug.owner, 'pandas');
    assert.equal(reqs['REQ-001'].blocked_from_status, 'review');

    await applyTransition(bug, 'in_progress');
    assert.equal(bug.owner, 'menglan');

    await applyTransition(bug, 'fixed');
    await applyTransition(bug, 'regressing');
    await applyTransition(bug, 'closed', { relatedReqs: reqs });
    assert.equal(bug.status, 'closed');

    // REQ restored to 'review', NOT 'req_review'
    assert.equal(reqs['REQ-001'].status, 'review');
    assert.equal(reqs['REQ-001'].blocked_reason, undefined);
  });
});

// ---------------------------------------------------------------------------
// GROUP B — Shared branch paths (TC-028-05 ~ 09)
// ---------------------------------------------------------------------------

describe('Group B — shared branch paths', () => {
  test('TC-028-05: confirmed → wont_fix is legal', async () => {
    const bug = makeBug({ status: 'confirmed' });
    await applyTransition(bug, 'wont_fix');
    assert.equal(bug.status, 'wont_fix');
  });

  test('TC-028-06: in_progress → wont_fix is legal', async () => {
    const bug = makeBug({ status: 'in_progress', owner: 'menglan' });
    await applyTransition(bug, 'wont_fix');
    assert.equal(bug.status, 'wont_fix');
  });

  test('TC-028-07: in_progress → open (reopen — plan not viable)', async () => {
    const bug = makeBug({ status: 'in_progress', owner: 'menglan' });
    await applyTransition(bug, 'open');
    assert.equal(bug.status, 'open');
  });

  test('TC-028-08: review_round cumulates to 3 → auto-blocked(review_round_exceeded)', async () => {
    const bug = makeBug({ status: 'in_progress', owner: 'menglan', review_round: 0 });
    const notified: string[] = [];
    const tgNotify = (msg: string) => notified.push(msg);

    // Round 1 rejection
    await applyTransition(bug, 'fixed');
    await applyTransition(bug, 'in_progress', { tgNotify });
    assert.equal(bug.review_round, 1);
    assert.equal(bug.status, 'in_progress');

    // Round 2 rejection
    await applyTransition(bug, 'fixed');
    await applyTransition(bug, 'in_progress', { tgNotify });
    assert.equal(bug.review_round, 2);
    assert.equal(bug.status, 'in_progress');

    // Round 3 rejection — should auto-block
    await applyTransition(bug, 'fixed');
    await applyTransition(bug, 'in_progress', { tgNotify });
    assert.equal(bug.review_round, 3);
    assert.equal(bug.status, 'blocked');
    assert.equal(bug.blocked_reason, 'review_round_exceeded');
    assert.ok(notified.length >= 1, 'tgNotify must be called at least once');
  });

  test('TC-028-09: blocked → unblock → restore blocked_from_status, clear fields', () => {
    const bug = makeBug({ status: 'in_progress', owner: 'menglan' });

    // Block with external_decision reason
    block(bug, 'external_decision');
    assert.equal(bug.status, 'blocked');
    assert.equal(bug.blocked_reason, 'external_decision');
    assert.equal(bug.blocked_from_status, 'in_progress');

    // Unblock — should restore to in_progress
    unblock(bug);
    assert.equal(bug.status, 'in_progress');
    assert.equal(bug.blocked_reason, undefined);
    assert.equal(bug.blocked_from_status, undefined);
  });
});

// ---------------------------------------------------------------------------
// GROUP C — user_bug GitHub sync paths (TC-028-10~13, 21~22) — DEFERRED
// These tests require a GhSyncService implementation in github-sync package.
// ---------------------------------------------------------------------------

describe('Group C — user_bug GitHub sync (deferred)', () => {
  test.todo('TC-028-10: user_bug regressing — GitHub issue closed → local status=closed');
  test.todo('TC-028-11: regressing validation notification is idempotent (sent exactly once)');
  test.todo('TC-028-12: regressing 14-day timeout → auto-close with comment');
  test.todo('TC-028-13: regressing < 14 days → no close, remaining days correct');
  test.todo('TC-028-21: user_bug local status change pushes status:* label to GitHub');
  test.todo('TC-028-22: create local BUG from new GitHub issue (§8.1) — idempotent');
});

// ---------------------------------------------------------------------------
// GROUP D — Illegal transition negative tests (TC-028-14 ~ 17)
// ---------------------------------------------------------------------------

describe('Group D — illegal transition negative tests', () => {
  test('TC-028-14: open → closed is illegal', () => {
    const result = validateTransition('open', 'closed');
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('open'), 'error should mention "open"');
  });

  test('TC-028-15: fixed → closed is illegal (must go through regressing)', () => {
    const result = validateTransition('fixed', 'closed');
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('fixed'));
  });

  test('TC-028-16: blocked → closed is illegal (must unblock first)', () => {
    const result = validateTransition('blocked', 'closed');
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('blocked'));
  });

  test('TC-028-17: user_bug regressing → closed rejected when GitHub issue is OPEN', async () => {
    const bug = makeBug({
      bug_type: 'user_bug',
      status: 'regressing',
      github_issue: '42',
    });
    const gh = makeGhMock({ issueView: async () => ({ state: 'OPEN' }) });

    await assert.rejects(
      () => applyTransition(bug, 'closed', { gh }),
      (err: unknown) => {
        assert.ok(err instanceof IllegalTransitionError, 'should throw IllegalTransitionError');
        return true;
      },
    );
    // Status unchanged
    assert.equal(bug.status, 'regressing');
  });
});

// ---------------------------------------------------------------------------
// GROUP E — Field validator unit tests (TC-028-18 ~ 20, 23 ~ 24)
// ---------------------------------------------------------------------------

describe('Group E — field validator', () => {
  test('TC-028-18: user_bug missing github_issue → validation error', () => {
    const errors = validateBugFields({ bug_type: 'user_bug', github_issue: '' });
    assert.ok(errors.length >= 1);
    const err = errors.find(e => e.field === 'github_issue');
    assert.ok(err, 'should have a github_issue error');
    assert.match(err.message, /github_issue.*required.*user_bug/i);
  });

  test('TC-028-19: blocked status missing blocked_reason → validation error', () => {
    const errors = validateBugFields({ status: 'blocked', blocked_reason: '' });
    assert.ok(errors.length >= 1);
    const err = errors.find(e => e.field === 'blocked_reason');
    assert.ok(err, 'should have a blocked_reason error');
    assert.match(err.message, /blocked_reason.*required.*blocked/i);
  });

  test('TC-028-20: in_progress + owner=unassigned → validation error', () => {
    const errors = validateBugFields({ status: 'in_progress', owner: 'unassigned' });
    assert.ok(errors.length >= 1);
    const err = errors.find(e => e.field === 'owner');
    assert.ok(err, 'should have an owner error');
    assert.match(err.message, /unassigned.*in_progress/i);
  });

  test('TC-028-23: blocked status missing blocked_from_status → validation error', () => {
    const errors = validateBugFields({
      status: 'blocked',
      blocked_reason: 'external_decision',
      blocked_from_status: '',
    });
    assert.ok(errors.length >= 1);
    const err = errors.find(e => e.field === 'blocked_from_status');
    assert.ok(err, 'should have a blocked_from_status error');
    assert.match(err.message, /blocked_from_status.*required.*blocked/i);
  });

  test('TC-028-24: review_round validation — illegal values rejected, legal values pass', () => {
    // Illegal: negative
    const e1 = validateBugFields({ review_round: '-1' });
    assert.ok(e1.some(e => e.field === 'review_round'), '-1 should fail');

    // Illegal: non-numeric string
    const e2 = validateBugFields({ review_round: 'abc' });
    assert.ok(e2.some(e => e.field === 'review_round'), 'abc should fail');

    // Illegal: decimal
    const e3 = validateBugFields({ review_round: '1.5' });
    assert.ok(e3.some(e => e.field === 'review_round'), '1.5 should fail');

    // Legal: '0'
    const e4 = validateBugFields({ review_round: '0' });
    assert.equal(e4.filter(e => e.field === 'review_round').length, 0, '0 should pass');

    // Legal: positive integer string
    const e5 = validateBugFields({ review_round: '3' });
    assert.equal(e5.filter(e => e.field === 'review_round').length, 0, '3 should pass');

    // Legal: field absent
    const e6 = validateBugFields({});
    assert.equal(e6.filter(e => e.field === 'review_round').length, 0, 'absent should pass');
  });
});

// ---------------------------------------------------------------------------
// Sanity: LEGAL_TRANSITIONS table integrity
// ---------------------------------------------------------------------------

describe('LEGAL_TRANSITIONS table', () => {
  test('all 8 states are present as keys', () => {
    const states = ['open', 'confirmed', 'in_progress', 'fixed', 'regressing', 'blocked', 'closed', 'wont_fix'];
    for (const s of states) {
      assert.ok(s in LEGAL_TRANSITIONS, `${s} should be a key in LEGAL_TRANSITIONS`);
    }
  });

  test('terminal states (closed, wont_fix) have no outgoing transitions', () => {
    assert.deepEqual(LEGAL_TRANSITIONS['closed'], []);
    assert.deepEqual(LEGAL_TRANSITIONS['wont_fix'], []);
  });
});
