#!/usr/bin/env node
// CLI wrapper for bug-state-machine
//
// SCOPE: single-bug state transitions only.
//
// Unsupported via CLI (use programmatic API instead):
//   - REQ blocking/unblocking: requires relatedReqs + allBugs context maps
//   - user_bug regressing→closed: requires a live GhClient (gh CLI) to verify
//     GitHub issue state before closing (bug-standard.md §8.4)
//
// Usage:
//   node --import tsx src/cli.ts applyTransition '<bug-json>' <to-state>
//   node --import tsx src/cli.ts validateTransition <from> <to>
//   node --import tsx src/cli.ts validateFields '<bug-json>'

import { validateTransition, applyTransition } from './machine.js';
import { validateBugFields } from './validator.js';
import type { BugFrontmatter, BugState } from './types.js';

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case 'applyTransition': {
      const bugJson = args[0];
      const to = args[1] as BugState;
      if (!bugJson || !to) {
        console.error('Usage: applyTransition <bug-json> <to-state>');
        process.exit(1);
      }
      const bug = JSON.parse(bugJson) as BugFrontmatter;

      // Guard: user_bug→closed requires GitHub issue state check — not available in CLI
      if (bug.bug_type === 'user_bug' && to === 'closed') {
        console.error(
          'Error: user_bug regressing→closed cannot be executed via CLI.\n' +
          'This transition requires a live GhClient to verify the GitHub issue is closed (§8.4).\n' +
          'Use the programmatic API with a GhClient, or run the sync script directly.',
        );
        process.exit(1);
      }

      // Reject: related_req is non-empty — partial transition would advance bug state
      // while skipping REQ blocking/unblocking, causing queue-state drift.
      if ((bug.related_req?.length ?? 0) > 0) {
        console.error(
          'Error: this bug has related_req entries. The CLI cannot supply relatedReqs or allBugs\n' +
          'context, so REQ blocking/unblocking side effects cannot be performed.\n' +
          'Proceeding would leave the bug state advanced while REQs remain in the wrong state.\n' +
          'Use the programmatic API (applyTransition with relatedReqs + allBugs) instead.',
        );
        process.exit(1);
      }

      const result = await applyTransition(bug, to);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'validateTransition': {
      const from = args[0] as BugState;
      const to = args[1] as BugState;
      if (!from || !to) {
        console.error('Usage: validateTransition <from> <to>');
        process.exit(1);
      }
      const result = validateTransition(from, to);
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) process.exit(1);
      break;
    }

    case 'validateFields': {
      const bugJson = args[0];
      if (!bugJson) {
        console.error('Usage: validateFields <bug-json>');
        process.exit(1);
      }
      const bug = JSON.parse(bugJson) as Record<string, unknown>;
      const errors = validateBugFields(bug);
      console.log(JSON.stringify(errors, null, 2));
      if (errors.length > 0) process.exit(1);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: applyTransition, validateTransition, validateFields');
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
