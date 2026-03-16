// FIELD VALIDATOR — bug frontmatter field rules
// Derived from bug-standard.md §3.2, §5.3, §12

import type { ValidationError } from './types.js';

// Accepts unknown input (e.g. parsed YAML) — review_round may be string or number
type BugInput = Record<string, unknown>;

export function validateBugFields(bug: BugInput): ValidationError[] {
  const errors: ValidationError[] = [];

  // user_bug requires github_issue (§3.2 + §12)
  if (bug['bug_type'] === 'user_bug') {
    const gi = bug['github_issue'];
    if (gi === undefined || gi === null || gi === '') {
      errors.push({
        field: 'github_issue',
        message: 'github_issue required for user_bug',
      });
    }
  }

  // status=blocked requires blocked_reason (§5.3 + §12)
  if (bug['status'] === 'blocked') {
    const br = bug['blocked_reason'];
    if (br === undefined || br === null || br === '') {
      errors.push({
        field: 'blocked_reason',
        message: 'blocked_reason required when status=blocked',
      });
    }
    // status=blocked also requires blocked_from_status (check-bug-coverage.sh rule)
    const bfs = bug['blocked_from_status'];
    if (bfs === undefined || bfs === null || bfs === '') {
      errors.push({
        field: 'blocked_from_status',
        message: 'blocked_from_status required when status=blocked',
      });
    }
  }

  // status=in_progress requires owner != 'unassigned' (§12)
  if (bug['status'] === 'in_progress') {
    if (bug['owner'] === 'unassigned') {
      errors.push({
        field: 'owner',
        message: 'owner must not be unassigned when status=in_progress',
      });
    }
  }

  // review_round must be non-negative integer when present (check-bug-coverage.sh: ^[0-9]+$)
  if (bug['review_round'] !== undefined && bug['review_round'] !== null) {
    const rr = String(bug['review_round']);
    if (!/^[0-9]+$/.test(rr)) {
      errors.push({
        field: 'review_round',
        message: `review_round must be a non-negative integer, got: ${rr}`,
      });
    }
  }

  return errors;
}
