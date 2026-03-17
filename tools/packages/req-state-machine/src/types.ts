// REQ STATE MACHINE — domain types
// Derived from harness/requirement-standard.md v0.4

export type ReqState =
  | 'draft'
  | 'review_ready'
  | 'req_review'
  | 'ready'
  | 'test_designed'
  | 'in_progress'
  | 'review'
  | 'blocked'
  | 'done';

// Full REQ frontmatter (§5.1 of requirement-standard.md)
export interface ReqFrontmatter {
  req_id: string;
  title: string;
  status: ReqState;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  phase: string;
  owner: string;
  blocked_reason?: string;
  blocked_from_status?: ReqState;
  /** Saved prior owner — set on block (bug_linked), restored on unblock, then deleted */
  blocked_from_owner?: string;
  review_round?: number;
  depends_on: string[];
  test_case_ref: string[];
  tc_policy: 'required' | 'optional' | 'exempt';
  tc_exempt_reason: string;
  scope: string;
  acceptance: string;
  pending_bugs: string[];
}

export interface ValidationError {
  field: string;
  message: string;
}

export class IllegalTransitionError extends Error {
  readonly from: ReqState;
  readonly to: ReqState;

  constructor(from: ReqState, to: ReqState, reason?: string) {
    super(`Illegal transition: ${from} → ${to}${reason ? ` (${reason})` : ''}`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.to = to;
  }
}

export interface ApplyTransitionOptions {
  /** Agent name used when routing owner to implementer (defaults to 'claude_code') */
  agentName?: string;
  /** Notification callback — called when review_round >= 2 on review→blocked */
  tgNotify?: (message: string) => void;
}
