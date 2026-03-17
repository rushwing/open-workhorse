// BUG STATE MACHINE — core logic
// Derived from bug-standard.md §5 (state machine) + §7 (review rounds)

import type {
  BugState,
  BugFrontmatter,
  ReqFrontmatter,
  ApplyTransitionOptions,
} from './types.js';
import { IllegalTransitionError } from './types.js';
import { resolveOwner } from './owner-router.js';

// §5.2 — legal transitions table
// Notes:
//   in_progress→open    : reopen (plan not viable, TC-028-07)
//   fixed→in_progress   : reviewer rejects — increments review_round (TC-028-08)
//   blocked→in_progress : unblock path (use unblock() helper instead of this directly)
//   regressing→closed   : user_bug requires GitHub issue to be closed (TC-028-17)
export const LEGAL_TRANSITIONS: Record<BugState, BugState[]> = {
  open:        ['confirmed', 'wont_fix'],
  confirmed:   ['in_progress', 'wont_fix'],
  in_progress: ['fixed', 'blocked', 'open', 'wont_fix'],
  fixed:       ['regressing', 'in_progress'],
  regressing:  ['in_progress', 'closed', 'wont_fix'],
  blocked:     ['in_progress'],
  closed:      [],
  wont_fix:    [],
};

export function validateTransition(
  from: BugState,
  to: BugState,
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

// Explicitly block a bug (sets blocked state + records blocked_from_status)
export function block(bug: BugFrontmatter, reason: string): BugFrontmatter {
  const { valid } = validateTransition(bug.status, 'blocked');
  if (!valid) {
    throw new IllegalTransitionError(bug.status, 'blocked');
  }
  const prevStatus = bug.status;
  bug.status = 'blocked';
  bug.blocked_reason = reason;
  bug.blocked_from_status = prevStatus;
  return bug;
}

// Unblock a bug — restores status from blocked_from_status, clears blocked fields
export function unblock(bug: BugFrontmatter): BugFrontmatter {
  if (bug.status !== 'blocked') {
    throw new Error(`Cannot unblock bug with status '${bug.status}' (not blocked)`);
  }
  const prevStatus = bug.blocked_from_status;
  if (!prevStatus) {
    throw new Error('Bug has no blocked_from_status to restore');
  }
  bug.status = prevStatus;
  delete bug.blocked_reason;
  delete bug.blocked_from_status;
  return bug;
}

// Unblock a REQ in-place — restores prior status and owner, clears blocked fields
function unblockReq(req: ReqFrontmatter): void {
  if (req.blocked_from_status) {
    req.status = req.blocked_from_status;
  }
  if (req.blocked_from_owner !== undefined) {
    req.owner = req.blocked_from_owner;
  }
  delete req.blocked_reason;
  delete req.blocked_from_status;
  delete req.blocked_from_owner;
}

export async function applyTransition(
  bug: BugFrontmatter,
  to: BugState,
  options?: ApplyTransitionOptions,
): Promise<BugFrontmatter> {
  const from = bug.status;

  // 1. Pure state machine validation
  const { valid, error } = validateTransition(from, to);
  if (!valid) {
    throw new IllegalTransitionError(from, to, error);
  }

  // 2. user_bug guard: regressing→closed requires GitHub issue to be closed (§8.4)
  if (bug.bug_type === 'user_bug' && to === 'closed') {
    const gh = options?.gh;
    if (!gh) {
      throw new IllegalTransitionError(
        from, to,
        'user_bug closed transition requires a GhClient to verify GitHub issue state',
      );
    }
    const issueState = await gh.issueView(bug.github_issue);
    if (issueState.state !== 'CLOSED') {
      throw new IllegalTransitionError(
        from, to,
        'user_bug can only be closed after GitHub issue is closed (state is OPEN)',
      );
    }
  }

  // 3. review_round increment: fixed→in_progress = reviewer rejects (§7.1)
  if (from === 'fixed' && to === 'in_progress') {
    bug.review_round = (bug.review_round ?? 0) + 1;
    if (bug.review_round >= 3) {
      // Auto-block on review_round_exceeded (§7.2)
      bug.status = 'blocked';
      bug.blocked_reason = 'review_round_exceeded';
      bug.blocked_from_status = 'in_progress';
      options?.tgNotify?.(
        `BUG ${bug.bug_id ?? '(unknown)'} review_round=${bug.review_round}, needs Daniel intervention`,
      );
      return bug;
    }
  }

  // 4. Apply status
  bug.status = to;

  // 5. Apply owner routing
  const route = resolveOwner(bug.bug_type, from, to);
  if (route) {
    bug.owner = route.owner;
    if (route.reviewer !== undefined) {
      bug.reviewer = route.reviewer;
    }
  }

  // 6. Auto-set blocked_from_status when transitioning to blocked
  if (to === 'blocked' && !bug.blocked_from_status) {
    bug.blocked_from_status = from;
  }

  // 7. REQ blocking: open→confirmed blocks related REQs (§2.2)
  // Guard: if the REQ is already blocked (e.g. by a sibling bug), preserve the
  // existing blocked_from_status and blocked_from_owner so unblock restores
  // the original pre-block state, not an intermediate 'blocked' snapshot.
  if (from === 'open' && to === 'confirmed' && options?.relatedReqs) {
    for (const reqId of bug.related_req ?? []) {
      const req = options.relatedReqs[reqId];
      if (req) {
        if (req.status !== 'blocked') {
          req.blocked_from_status = req.status;
          req.blocked_from_owner = req.owner; // P1-2: preserve prior owner
        }
        req.status = 'blocked';
        req.blocked_reason = 'bug_linked';
        req.owner = 'unassigned';
      }
    }
  }

  // 8. REQ unblocking: regressing→closed unblocks related REQs (§2.3)
  // A REQ is only unblocked when no other open bug references it.
  // allBugs MUST be supplied when relatedReqs contains a blocked REQ — omitting it
  // would silently bypass the sibling check and allow premature unblocking.
  if (from === 'regressing' && to === 'closed' && options?.relatedReqs) {
    for (const reqId of bug.related_req ?? []) {
      const req = options.relatedReqs[reqId];
      if (!req || req.status !== 'blocked') continue;

      if (options.allBugs === undefined) {
        throw new Error(
          `applyTransition: allBugs is required when relatedReqs contains a blocked REQ ("${reqId}"). ` +
          'Omitting it bypasses the sibling-open check and may unblock the REQ prematurely.',
        );
      }

      const hasOpenSibling = options.allBugs.some(
        (b) =>
          b !== bug &&
          b.related_req?.includes(reqId) &&
          b.status !== 'closed' &&
          b.status !== 'wont_fix',
      );
      if (!hasOpenSibling) {
        unblockReq(req);
      }
    }
  }

  return bug;
}
