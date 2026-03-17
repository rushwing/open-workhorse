// REQ STATE MACHINE — core logic
// Derived from requirement-standard.md §6.2 (state machine)

import type {
  ReqState,
  ReqFrontmatter,
  ApplyTransitionOptions,
} from './types.js';
import { IllegalTransitionError } from './types.js';
import { resolveOwner } from './owner-router.js';

// §6.2 — legal transitions table
// Notes:
//   req_review → test_designed : folded path (Huahua merges TC design step)
//   ready → in_progress        : only when tc_policy != 'required'
//   review → blocked           : increments review_round; if >= 2, tgNotify
//   blocked → *                : use unblock() API; applyTransition from blocked is always illegal
export const LEGAL_TRANSITIONS: Record<ReqState, ReqState[]> = {
  draft:         ['review_ready'],
  review_ready:  ['req_review'],
  req_review:    ['ready', 'test_designed', 'blocked'],
  ready:         ['test_designed', 'in_progress', 'blocked'],
  test_designed: ['in_progress', 'blocked'],
  in_progress:   ['review', 'blocked'],
  review:        ['done', 'blocked'],
  blocked:       [],
  done:          [],
};

export function validateTransition(
  from: ReqState,
  to: ReqState,
): { valid: boolean; error?: string } {
  const allowed = LEGAL_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return {
      valid: false,
      error: `Illegal transition: ${from} → ${to}. Allowed from ${from}: [${allowed.join(', ') || 'none'}]`,
    };
  }
  return { valid: true };
}

// Explicitly block a REQ (sets blocked state + records blocked_from_status)
// Owner clearing: only when reason='bug_linked' (§6.2 — "若 blocked_reason=bug_linked,
// 还须写入 blocked_from_owner 并将 owner 清空为 unassigned")
export function block(req: ReqFrontmatter, reason: string): ReqFrontmatter {
  // Any non-terminal, non-blocked state can be blocked
  const terminalOrBlocked: ReqState[] = ['blocked', 'done'];
  if (terminalOrBlocked.includes(req.status)) {
    throw new IllegalTransitionError(req.status, 'blocked',
      `cannot block a REQ with status '${req.status}'`);
  }
  const prevStatus = req.status;
  req.status = 'blocked';
  req.blocked_reason = reason;
  req.blocked_from_status = prevStatus;
  if (reason === 'bug_linked') {
    req.blocked_from_owner = req.owner;
    req.owner = 'unassigned';
  }
  return req;
}

// Unblock a REQ — restores status from blocked_from_status, owner from blocked_from_owner if set
export function unblock(req: ReqFrontmatter): ReqFrontmatter {
  if (req.status !== 'blocked') {
    throw new Error(`Cannot unblock req with status '${req.status}' (not blocked)`);
  }
  const prevStatus = req.blocked_from_status;
  if (!prevStatus) {
    throw new Error('Req has no blocked_from_status to restore');
  }
  req.status = prevStatus;
  if (req.blocked_from_owner !== undefined) {
    req.owner = req.blocked_from_owner;
  }
  delete req.blocked_reason;
  delete req.blocked_from_status;
  delete req.blocked_from_owner;
  return req;
}

export function applyTransition(
  req: ReqFrontmatter,
  to: ReqState,
  options?: ApplyTransitionOptions,
): ReqFrontmatter {
  const from = req.status;

  // 1. Pure state machine validation
  const { valid, error } = validateTransition(from, to);
  if (!valid) {
    throw new IllegalTransitionError(from, to, error);
  }

  // 2. Guard: to=blocked requires blockedReason (§6.2 — "必须同时写入 blocked_reason")
  if (to === 'blocked') {
    if (!options?.blockedReason) {
      throw new Error(
        `applyTransition: blockedReason is required when transitioning to 'blocked' (§6.2)`,
      );
    }
  }

  // 3. Guard: ready → in_progress blocked when tc_policy='required' (§6.3)
  if (from === 'ready' && to === 'in_progress') {
    if (req.tc_policy === 'required') {
      throw new IllegalTransitionError(
        from, to,
        'ready → in_progress is not allowed when tc_policy=required (must go through test_designed)',
      );
    }
  }

  // 4. Guard: review → done blocked when pending_bugs is non-empty (§6.2 Bug clean gate)
  if (from === 'review' && to === 'done') {
    if (req.pending_bugs && req.pending_bugs.length > 0) {
      throw new IllegalTransitionError(
        from, to,
        `review → done blocked: pending_bugs is non-empty [${req.pending_bugs.join(', ')}]`,
      );
    }
  }

  // 5. review → blocked: increment review_round; if >= 2 call tgNotify
  if (from === 'review' && to === 'blocked') {
    req.review_round = (req.review_round ?? 0) + 1;
    if (req.review_round >= 2) {
      options?.tgNotify?.(
        `REQ ${req.req_id ?? '(unknown)'} review_round=${req.review_round}, needs Daniel intervention`,
      );
    }
  }

  // 6. Apply status
  req.status = to;

  // 7. Apply owner routing (blocked path: only bug_linked clears owner per §6.2)
  if (to === 'blocked') {
    req.blocked_from_status = from;
    req.blocked_reason = options!.blockedReason;
    if (options!.blockedReason === 'bug_linked') {
      req.blocked_from_owner = req.owner;
      req.owner = 'unassigned';
    }
  } else {
    const route = resolveOwner(from, to, {
      reviewerAgent: options?.reviewerAgent,
      implementerAgent: options?.implementerAgent,
    });
    if (route) {
      req.owner = route.owner;
    }
  }

  return req;
}
