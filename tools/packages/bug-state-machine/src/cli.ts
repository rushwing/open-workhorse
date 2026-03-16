#!/usr/bin/env node
// CLI wrapper for bug-state-machine
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
