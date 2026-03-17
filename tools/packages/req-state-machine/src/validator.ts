// FIELD VALIDATOR — req frontmatter field rules
// Derived from requirement-standard.md §5.1, §6.2, §6.5

import type { ValidationError } from './types.js';

// Accepts unknown input (e.g. parsed YAML)
type ReqInput = Record<string, unknown>;

export function validateReqFields(req: ReqInput): ValidationError[] {
  const errors: ValidationError[] = [];

  // status=blocked requires blocked_reason (§6.2)
  if (req['status'] === 'blocked') {
    const br = req['blocked_reason'];
    if (br === undefined || br === null || br === '') {
      errors.push({
        field: 'blocked_reason',
        message: 'blocked_reason required when status=blocked',
      });
    }

    // status=blocked also requires blocked_from_status
    const bfs = req['blocked_from_status'];
    if (bfs === undefined || bfs === null || bfs === '') {
      errors.push({
        field: 'blocked_from_status',
        message: 'blocked_from_status required when status=blocked',
      });
    }

    // blocked_reason=bug_linked requires blocked_from_owner (§6.2)
    if (req['blocked_reason'] === 'bug_linked') {
      const bfo = req['blocked_from_owner'];
      if (bfo === undefined || bfo === null || bfo === '') {
        errors.push({
          field: 'blocked_from_owner',
          message: 'blocked_from_owner required when blocked_reason=bug_linked',
        });
      }
    }
  }

  // status=in_progress requires owner != 'unassigned' (§5.1)
  if (req['status'] === 'in_progress') {
    if (req['owner'] === 'unassigned') {
      errors.push({
        field: 'owner',
        message: 'owner must not be unassigned when status=in_progress',
      });
    }
  }

  return errors;
}
