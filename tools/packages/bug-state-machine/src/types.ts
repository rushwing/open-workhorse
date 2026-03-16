// BUG STATE MACHINE — domain types
// Derived from harness/bug-standard.md v0.3.3

export type BugState =
  | 'open'
  | 'confirmed'
  | 'in_progress'
  | 'fixed'
  | 'regressing'
  | 'blocked'
  | 'closed'
  | 'wont_fix';

export type BugType =
  | 'req_bug'
  | 'tc_bug'
  | 'impl_bug'
  | 'ci_bug'
  | 'user_bug';

// Minimal REQ frontmatter shape — only the fields the state machine cares about
export interface ReqFrontmatter {
  status: string;
  owner?: string;
  blocked_reason?: string;
  blocked_from_status?: string;
  /** Saved prior owner — set on block, restored on unblock, then deleted */
  blocked_owner_backup?: string;
}

// Full bug frontmatter (§3.2 of bug-standard.md)
export interface BugFrontmatter {
  bug_id: string;
  bug_type: BugType;
  title: string;
  status: BugState;
  severity: 'S1' | 'S2' | 'S3' | 'S4';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  owner: string;
  related_req: string[];
  related_tc: string[];
  tc_policy: 'required' | 'optional' | 'exempt';
  tc_exempt_reason: string;
  reported_by: string;
  review_round: number;
  depends_on: string[];
  github_issue: string;
  regressing_notified: boolean;
  regressing_notified_at: string;
  // Optional fields set during state transitions
  blocked_reason?: string;
  blocked_from_status?: BugState;
  reviewer?: string;
  agent_notes?: string;
}

export interface ValidationError {
  field: string;
  message: string;
}

export class IllegalTransitionError extends Error {
  readonly from: BugState;
  readonly to: BugState;

  constructor(from: BugState, to: BugState, reason?: string) {
    super(`Illegal transition: ${from} → ${to}${reason ? ` (${reason})` : ''}`);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.to = to;
  }
}

// GitHub API client interface — injected as dependency for user_bug operations
export interface GhClient {
  issueView(number: string | number): Promise<{ state: 'OPEN' | 'CLOSED' }>;
  issueComment(number: string | number, body: string): Promise<void>;
  issueClose(number: string | number): Promise<void>;
  issueAddLabel(number: string | number, label: string): Promise<void>;
  issueRemoveLabel(number: string | number, label: string): Promise<void>;
  issueList(): Promise<Array<{ number: number; title: string; labels: string[] }>>;
}

export interface ApplyTransitionOptions {
  /** Mutable map of REQ fixtures — mutated in-place for blocking/unblocking */
  relatedReqs?: Record<string, ReqFrontmatter>;
  /**
   * All known bugs in the system — used when unblocking REQs to check whether
   * sibling bugs (other bugs also linked to the same REQ) are still open.
   * A REQ is only unblocked when NO other bug referencing it remains unresolved.
   * (§2.3: "若该 REQ 的 Agent Notes 中无其他未关闭 Bug")
   */
  allBugs?: BugFrontmatter[];
  /** GitHub client — required for user_bug regressing→closed */
  gh?: GhClient;
  /** Notification callback — called when review_round_exceeded auto-blocks */
  tgNotify?: (message: string) => void;
}
