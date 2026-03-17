// L1 tests for bug-state-machine — covers TC-028-01 through TC-028-25
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
  UserBugSync,
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

    // Step 7: regressing → closed (allBugs required for sibling check)
    await applyTransition(bug, 'closed', { relatedReqs: reqs, allBugs: [bug] });
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
    await applyTransition(bug, 'closed', { relatedReqs: reqs, allBugs: [bug] });
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
    await applyTransition(bug, 'closed', { relatedReqs: reqs, allBugs: [bug] });
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
    await applyTransition(bug, 'closed', { relatedReqs: reqs, allBugs: [bug] });
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
// GROUP C — user_bug GitHub sync paths (TC-028-10~13, 21~22)
// All implemented using mocked GhClient via UserBugSync.
// ---------------------------------------------------------------------------

describe('Group C — user_bug GitHub sync', () => {
  const TODAY = '2026-03-16';
  const makeDate = (isoDate: string) => new Date(isoDate + 'T12:00:00Z');

  test('TC-028-10: user_bug regressing — GitHub issue CLOSED → local status=closed', async () => {
    const bug = makeBug({
      bug_type: 'user_bug', status: 'regressing', github_issue: '42',
    });
    const issueCloseCalled: number[] = [];
    const gh = makeGhMock({
      issueView: async () => ({ state: 'CLOSED' }),
      issueClose: async (n) => { issueCloseCalled.push(Number(n)); },
    });
    const sync = new UserBugSync(gh);
    await sync.syncClose(bug);

    assert.equal(bug.status, 'closed');
    assert.ok(bug.agent_notes?.includes('closed'), 'agent_notes should record close source');
    assert.equal(issueCloseCalled.length, 0, 'gh.issueClose must NOT be called (user already closed it)');
  });

  test('TC-028-11: regressing notification is idempotent — sent exactly once', async () => {
    const bug = makeBug({
      bug_type: 'user_bug', status: 'regressing', github_issue: '42',
      regressing_notified: false, regressing_notified_at: '',
    });
    let commentCallCount = 0;
    const gh = makeGhMock({ issueComment: async () => { commentCallCount++; } });
    const sync = new UserBugSync(gh, () => makeDate(TODAY));

    // First run: sends notification
    await sync.syncRegressingNotification(bug);
    assert.equal(commentCallCount, 1);
    assert.equal(bug.regressing_notified, true);
    assert.equal(bug.regressing_notified_at, TODAY);

    // Second run: state unchanged, must not send again
    await sync.syncRegressingNotification(bug);
    assert.equal(commentCallCount, 1, 'issueComment must not be called a second time');
  });

  test('TC-028-12: regressing 14-day timeout → auto-close with comment', async () => {
    const notifiedAt = '2026-03-01'; // 15 days before TODAY
    const bug = makeBug({
      bug_type: 'user_bug', status: 'regressing', github_issue: '42',
      regressing_notified: true, regressing_notified_at: notifiedAt,
    });
    const commentBodies: string[] = [];
    const closedIssues: number[] = [];
    const gh = makeGhMock({
      issueView: async () => ({ state: 'OPEN' }),
      issueComment: async (_, body) => { commentBodies.push(body as string); },
      issueClose: async (n) => { closedIssues.push(Number(n)); },
    });
    const sync = new UserBugSync(gh, () => makeDate(TODAY));

    await sync.syncRegressingNotification(bug);

    assert.ok(commentBodies.length >= 1, 'timeout comment must be posted');
    assert.ok(commentBodies[0].includes('14天'), 'comment should mention 14天');
    assert.equal(closedIssues[0], 42, 'gh.issueClose must be called');
    assert.equal(bug.status, 'closed');
    assert.ok(bug.agent_notes?.includes('14天'), 'agent_notes should record auto-close reason');
  });

  test('TC-028-13: regressing 5 days in — no auto-close, daysRemaining=9', async () => {
    const notifiedAt = '2026-03-11'; // 5 days before TODAY
    const bug = makeBug({
      bug_type: 'user_bug', status: 'regressing', github_issue: '42',
      regressing_notified: true, regressing_notified_at: notifiedAt,
    });
    const closedIssues: number[] = [];
    const gh = makeGhMock({
      issueView: async () => ({ state: 'OPEN' }),
      issueClose: async (n) => { closedIssues.push(Number(n)); },
    });
    const sync = new UserBugSync(gh, () => makeDate(TODAY));

    const result = await sync.syncRegressingNotification(bug);

    assert.equal(closedIssues.length, 0, 'gh.issueClose must NOT be called');
    assert.equal(bug.status, 'regressing', 'status must remain regressing');
    assert.equal(result.daysRemaining, 9, 'daysRemaining should be 9 (14 - 5)');
  });

  test('TC-028-21: status label push — sync mismatched label; skip when already in sync', async () => {
    const bug = makeBug({ bug_type: 'user_bug', status: 'in_progress', github_issue: '42' });
    const removed: string[] = [];
    const added: string[] = [];
    const gh = makeGhMock({
      issueRemoveLabel: async (_, l) => { removed.push(l as string); },
      issueAddLabel: async (_, l) => { added.push(l as string); },
    });
    const sync = new UserBugSync(gh);

    // Labels include old status:confirmed — should be replaced
    await sync.syncStatusLabel(bug, ['bug-tracked', 'status:confirmed']);
    assert.ok(removed.includes('status:confirmed'), 'old status label must be removed');
    assert.ok(added.includes('status:in_progress'), 'new status label must be added');
    assert.ok(!removed.includes('bug-tracked'), 'bug-tracked must not be touched');

    removed.length = 0;
    added.length = 0;

    // Second sync: labels already in sync — no calls expected
    await sync.syncStatusLabel(bug, ['bug-tracked', 'status:in_progress']);
    assert.equal(removed.length, 0, 'no remove call when already in sync');
    assert.equal(added.length, 0, 'no add call when already in sync');
  });

  test('TC-028-22: create local BUG from GitHub issue — idempotent', async () => {
    const newIssue = { number: 99, title: 'Button crash on submit', labels: [] };
    const trackedIssue = { number: 99, title: 'Button crash on submit', labels: ['bug-tracked'] };
    const addedLabels: string[] = [];
    const gh = makeGhMock({
      issueAddLabel: async (_, l) => { addedLabels.push(l as string); },
    });
    const sync = new UserBugSync(gh);

    // First run: issue has no bug-tracked label → create BUG
    const r1 = await sync.createBugFromIssue(newIssue, 'BUG-042');
    assert.equal(r1.created, true);
    assert.ok(r1.bugContent?.includes('bug_type: user_bug'));
    assert.ok(r1.bugContent?.includes('github_issue: "99"'));
    assert.ok(r1.bugContent?.includes('status: open'));
    assert.ok(r1.bugContent?.includes('severity:'), 'severity must be present (required by §3.2)');
    assert.ok(r1.bugContent?.includes('priority:'), 'priority must be present (required by §3.2)');
    assert.ok(addedLabels.includes('bug-tracked'), 'bug-tracked label must be added');

    addedLabels.length = 0;

    // Second run: issue already has bug-tracked → skip, idempotent
    const r2 = await sync.createBugFromIssue(trackedIssue, 'BUG-043');
    assert.equal(r2.created, false);
    assert.equal(addedLabels.length, 0, 'no label call when already tracked');
  });
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
// GROUP E — Field validator unit tests (TC-028-18 ~ 20, 23 ~ 25)
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

  test('TC-028-25: bug_linked block saves blocked_from_owner; unblock restores owner', async () => {
    // req_bug is the type tied to the req_review branch (§2.1)
    const bug = makeBug({ bug_type: 'req_bug', status: 'open', related_req: ['REQ-001'] });
    const reqs: Record<string, ReqFrontmatter> = {
      'REQ-001': { status: 'req_review', owner: 'huahua' },
    };

    // Trigger REQ blocking via bug confirmation (bug_linked reason, §2.2)
    await applyTransition(bug, 'confirmed', { relatedReqs: reqs });

    // REQ is now blocked; blocked_from_owner saved, owner cleared to unassigned
    assert.equal(reqs['REQ-001'].status, 'blocked');
    assert.equal(reqs['REQ-001'].blocked_reason, 'bug_linked');
    assert.equal(reqs['REQ-001'].blocked_from_status, 'req_review');
    assert.equal(reqs['REQ-001'].blocked_from_owner, 'huahua', 'prior owner must be saved');
    assert.equal(reqs['REQ-001'].owner, 'unassigned', 'owner must be cleared on block');

    // Negative branch: simulate REQ with bug_linked but no blocked_from_owner
    // → unblock cannot restore owner (stays unassigned)
    const brokenReq: ReqFrontmatter = {
      status: 'blocked',
      owner: 'unassigned',
      blocked_reason: 'bug_linked',
      blocked_from_status: 'req_review',
      // blocked_from_owner intentionally absent
    };
    const bugForBroken = makeBug({ bug_type: 'req_bug', status: 'regressing', related_req: ['REQ-BROKEN'] });
    const brokenReqs: Record<string, ReqFrontmatter> = { 'REQ-BROKEN': brokenReq };
    await applyTransition(bugForBroken, 'closed', { relatedReqs: brokenReqs, allBugs: [bugForBroken] });
    assert.equal(brokenReqs['REQ-BROKEN'].owner, 'unassigned',
      'owner must stay unassigned when blocked_from_owner was absent');

    // Happy path: close the original bug → REQ unblocked, owner restored
    await applyTransition(bug, 'in_progress');
    await applyTransition(bug, 'fixed');
    await applyTransition(bug, 'regressing');
    await applyTransition(bug, 'closed', { relatedReqs: reqs, allBugs: [bug] });

    assert.equal(reqs['REQ-001'].status, 'req_review', 'REQ status must be restored');
    assert.equal(reqs['REQ-001'].owner, 'huahua', 'owner must be restored from blocked_from_owner');
    assert.equal(reqs['REQ-001'].blocked_from_owner, undefined, 'blocked_from_owner must be cleared');
    assert.equal(reqs['REQ-001'].blocked_reason, undefined, 'blocked_reason must be cleared');
  });
});

// ---------------------------------------------------------------------------
// Regression: P1-1 — premature REQ unblock when sibling bug is still open
// ---------------------------------------------------------------------------

describe('REQ unblock — sibling bug guard (P1-1 regression)', () => {
  test('REQ stays blocked when a second bug referencing it is still open', async () => {
    const bug1 = makeBug({ bug_id: 'BUG-001', bug_type: 'impl_bug', status: 'open', related_req: ['REQ-001'] });
    const bug2 = makeBug({ bug_id: 'BUG-002', bug_type: 'impl_bug', status: 'open', related_req: ['REQ-001'] });
    const reqs: Record<string, ReqFrontmatter> = { 'REQ-001': { status: 'in_progress', owner: 'menglan' } };

    // Both bugs confirm and block REQ-001
    await applyTransition(bug1, 'confirmed', { relatedReqs: reqs });
    await applyTransition(bug2, 'confirmed', { relatedReqs: reqs });
    assert.equal(reqs['REQ-001'].status, 'blocked');

    // bug1 reaches closed — but bug2 is still open, so REQ must stay blocked
    await applyTransition(bug1, 'in_progress');
    await applyTransition(bug1, 'fixed');
    await applyTransition(bug1, 'regressing');
    await applyTransition(bug1, 'closed', {
      relatedReqs: reqs,
      allBugs: [bug1, bug2],
    });

    assert.equal(reqs['REQ-001'].status, 'blocked', 'REQ must stay blocked while bug2 is open');
    assert.equal(bug2.status, 'confirmed', 'bug2 is still open');
  });

  test('REQ is unblocked only after the last sibling bug closes', async () => {
    const bug1 = makeBug({ bug_id: 'BUG-001', bug_type: 'impl_bug', status: 'open', related_req: ['REQ-001'] });
    const bug2 = makeBug({ bug_id: 'BUG-002', bug_type: 'impl_bug', status: 'open', related_req: ['REQ-001'] });
    const reqs: Record<string, ReqFrontmatter> = { 'REQ-001': { status: 'in_progress', owner: 'menglan' } };

    await applyTransition(bug1, 'confirmed', { relatedReqs: reqs });
    await applyTransition(bug2, 'confirmed', { relatedReqs: reqs });

    // Close bug2 first — REQ still blocked because bug1 is still open
    await applyTransition(bug2, 'in_progress');
    await applyTransition(bug2, 'fixed');
    await applyTransition(bug2, 'regressing');
    await applyTransition(bug2, 'closed', { relatedReqs: reqs, allBugs: [bug1, bug2] });
    assert.equal(reqs['REQ-001'].status, 'blocked', 'REQ still blocked after first closure');

    // Close bug1 — now no open siblings, REQ should unblock
    await applyTransition(bug1, 'in_progress');
    await applyTransition(bug1, 'fixed');
    await applyTransition(bug1, 'regressing');
    await applyTransition(bug1, 'closed', { relatedReqs: reqs, allBugs: [bug1, bug2] });
    assert.equal(reqs['REQ-001'].status, 'in_progress', 'REQ should be unblocked now');
    assert.equal(reqs['REQ-001'].blocked_reason, undefined);
  });
});

// ---------------------------------------------------------------------------
// Regression: P1-2 — REQ owner restored correctly after unblock
// ---------------------------------------------------------------------------

describe('REQ owner preservation on block/unblock (P1-2 regression)', () => {
  test('REQ owner is saved on block and restored on unblock', async () => {
    const bug = makeBug({ bug_type: 'impl_bug', status: 'open', related_req: ['REQ-001'] });
    const reqs: Record<string, ReqFrontmatter> = {
      'REQ-001': { status: 'in_progress', owner: 'menglan' },
    };

    // Block
    await applyTransition(bug, 'confirmed', { relatedReqs: reqs });
    assert.equal(reqs['REQ-001'].status, 'blocked');
    assert.equal(reqs['REQ-001'].owner, 'unassigned');
    assert.equal(reqs['REQ-001'].blocked_from_owner, 'menglan');

    // Close bug → unblock
    await applyTransition(bug, 'in_progress');
    await applyTransition(bug, 'fixed');
    await applyTransition(bug, 'regressing');
    await applyTransition(bug, 'closed', { relatedReqs: reqs, allBugs: [bug] });

    assert.equal(reqs['REQ-001'].status, 'in_progress');
    assert.equal(reqs['REQ-001'].owner, 'menglan', 'prior owner should be restored');
    assert.equal(reqs['REQ-001'].blocked_from_owner, undefined, 'backup field should be cleared');
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
