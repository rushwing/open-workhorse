// OWNER ROUTER — §8.4 + §6.2 of requirement-standard.md v0.4

import type { ReqState } from './types.js';

interface OwnerRoute {
  owner: string;
}

export function resolveOwner(
  _from: ReqState,
  to: ReqState,
  options?: { reviewerAgent?: string; implementerAgent?: string },
): OwnerRoute | undefined {
  const reviewer = options?.reviewerAgent ?? 'huahua';
  const implementer = options?.implementerAgent ?? 'claude_code';

  switch (to) {
    case 'req_review':
    case 'ready':
    case 'test_designed':
      return { owner: reviewer };
    case 'in_progress':
      return { owner: implementer };
    case 'done':
      return { owner: 'unassigned' };
    default:
      return undefined;
  }
}
