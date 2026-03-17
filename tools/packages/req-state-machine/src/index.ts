// Public API for @open-workhorse/req-state-machine

export type {
  ReqState,
  ReqFrontmatter,
  ValidationError,
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

export { validateReqFields } from './validator.js';
export { resolveOwner } from './owner-router.js';
