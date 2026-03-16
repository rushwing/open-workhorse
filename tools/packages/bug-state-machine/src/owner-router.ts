// OWNER ROUTER — §2.4 + §6.1 of bug-standard.md
// First hop is always pandas (open→confirmed).
// Fix owner and reviewer are determined by bug_type.

import type { BugType, BugState } from './types.js';

interface OwnerRoute {
  owner: string;
  reviewer?: string;
}

// Key format: "from→to"
const ROUTING: Partial<Record<BugType, Record<string, OwnerRoute>>> = {
  req_bug: {
    'open→confirmed':       { owner: 'pandas' },
    'confirmed→in_progress':{ owner: 'menglan', reviewer: 'huahua' },
  },
  tc_bug: {
    'open→confirmed':       { owner: 'pandas' },
    'confirmed→in_progress':{ owner: 'huahua', reviewer: 'menglan' },
  },
  impl_bug: {
    'open→confirmed':       { owner: 'pandas' },
    'confirmed→in_progress':{ owner: 'menglan', reviewer: 'huahua' },
  },
  ci_bug: {
    'open→confirmed':       { owner: 'pandas' },
    'confirmed→in_progress':{ owner: 'menglan', reviewer: 'huahua' },
  },
  user_bug: {
    'open→confirmed':       { owner: 'pandas' },
    'confirmed→in_progress':{ owner: 'menglan', reviewer: 'huahua' },
  },
};

export function resolveOwner(
  bugType: BugType,
  from: BugState,
  to: BugState,
): OwnerRoute | undefined {
  return ROUTING[bugType]?.[`${from}→${to}`];
}
