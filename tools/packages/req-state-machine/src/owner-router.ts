// OWNER ROUTER — §8.4 + §6.2 of requirement-standard.md v0.4

import type { ReqState } from './types.js';

interface OwnerRoute {
  owner: string;
}

// Key format: "→to" (target state determines owner)
// agentName is injected at call time for in_progress and review transitions.
const STATIC_ROUTING: Partial<Record<string, OwnerRoute>> = {
  '→req_review':    { owner: 'huahua' },
  '→ready':         { owner: 'huahua' },
  '→test_designed': { owner: 'huahua' },
  '→done':          { owner: 'unassigned' },
  '→blocked':       { owner: 'unassigned' },
};

export function resolveOwner(
  _from: ReqState,
  to: ReqState,
  agentName?: string,
): OwnerRoute | undefined {
  if (to === 'in_progress') {
    return { owner: agentName ?? 'claude_code' };
  }
  return STATIC_ROUTING[`→${to}`];
}
