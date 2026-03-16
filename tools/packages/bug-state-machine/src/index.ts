// Public API for @open-workhorse/bug-state-machine

export type {
  BugState,
  BugType,
  BugFrontmatter,
  ReqFrontmatter,
  ValidationError,
  GhClient,
  ApplyTransitionOptions,
} from './types.js';
export { IllegalTransitionError } from './types.js';

export {
  LEGAL_TRANSITIONS,
  validateTransition,
  applyTransition,
  block,
  unblock,
} from './machine.js';

export { validateBugFields } from './validator.js';
export { resolveOwner } from './owner-router.js';
