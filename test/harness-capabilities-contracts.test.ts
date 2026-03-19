// Contract tests for harness/CAPABILITIES.md and harness/CONNECTORS.md
// TC-CAP-01 ~ TC-CAP-09

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT = process.cwd();
const CAPS_FILE = join(PROJECT_ROOT, 'harness', 'CAPABILITIES.md');
const CONN_FILE = join(PROJECT_ROOT, 'harness', 'CONNECTORS.md');

// ---------------------------------------------------------------------------
// TC-CAP-01: harness/CAPABILITIES.md exists
// ---------------------------------------------------------------------------

describe('TC-CAP-01: harness/CAPABILITIES.md exists', () => {
  test('CAPABILITIES.md exists', () => {
    assert.ok(existsSync(CAPS_FILE), `harness/CAPABILITIES.md must exist at ${CAPS_FILE}`);
  });
});

// ---------------------------------------------------------------------------
// TC-CAP-02: harness/CONNECTORS.md exists
// ---------------------------------------------------------------------------

describe('TC-CAP-02: harness/CONNECTORS.md exists', () => {
  test('CONNECTORS.md exists', () => {
    assert.ok(existsSync(CONN_FILE), `harness/CONNECTORS.md must exist at ${CONN_FILE}`);
  });
});

// ---------------------------------------------------------------------------
// TC-CAP-03: all capability names in CAPABILITIES.md match naming pattern
// ---------------------------------------------------------------------------

describe('TC-CAP-03: capability names match [a-z]+-[a-z]+-[a-z_]+', () => {
  test('all capability: lines match naming convention', () => {
    const content = readFileSync(CAPS_FILE, 'utf8');
    const lines = content.split('\n');
    const capabilityLines = lines.filter(l => l.match(/^capability:\s+\S/));
    assert.ok(capabilityLines.length > 0, 'CAPABILITIES.md must contain at least one capability: line');
    const PATTERN = /^capability:\s+[a-z]+-[a-z]+-[a-z_]+$/;
    for (const line of capabilityLines) {
      assert.match(line.trim(), PATTERN, `capability name must match [a-z]+-[a-z]+-[a-z_]+: "${line.trim()}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-CAP-04: every capability in Index table has a Connector Spec section
// ---------------------------------------------------------------------------

describe('TC-CAP-04: every Index capability has a Connector Spec section in CAPABILITIES.md', () => {
  test('all index table rows have a matching ### spec block', () => {
    const content = readFileSync(CAPS_FILE, 'utf8');
    // Extract capability names from index table rows: | `name` | ...
    const indexPattern = /^\|\s+`([a-z]+-[a-z]+-[a-z_]+)`\s+\|/gm;
    const indexNames: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = indexPattern.exec(content)) !== null) {
      indexNames.push(m[1]);
    }
    assert.ok(indexNames.length > 0, 'CAPABILITIES.md Index table must contain capability rows');

    // Each index name should have a matching ### `name` spec block
    for (const name of indexNames) {
      const specPattern = new RegExp(`^### \`${name}\``, 'm');
      assert.ok(
        specPattern.test(content),
        `Index capability "${name}" must have a matching ### \`${name}\` spec block in CAPABILITIES.md`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// TC-CAP-05: every capability in CONNECTORS.md master index also appears in CAPABILITIES.md
// ---------------------------------------------------------------------------

describe('TC-CAP-05: CONNECTORS.md master index capabilities all appear in CAPABILITIES.md', () => {
  test('all CONNECTORS index names are present in CAPABILITIES.md', () => {
    const capsContent = readFileSync(CAPS_FILE, 'utf8');
    const connContent = readFileSync(CONN_FILE, 'utf8');

    // Extract capability names from CONNECTORS.md master index table
    const connPattern = /^\|\s+`([a-z]+-[a-z]+-[a-z_]+)`\s+\|/gm;
    const connNames: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = connPattern.exec(connContent)) !== null) {
      connNames.push(m[1]);
    }
    assert.ok(connNames.length > 0, 'CONNECTORS.md Master Index must contain capability rows');

    for (const name of connNames) {
      assert.ok(
        capsContent.includes(`\`${name}\``),
        `CONNECTORS.md capability "${name}" must also appear in CAPABILITIES.md`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// TC-CAP-06: no specialist-only capabilities in CAPABILITIES.md
// ---------------------------------------------------------------------------

describe('TC-CAP-06: CAPABILITIES.md must not contain implement-code or diff-review', () => {
  test('no implement-code capability', () => {
    const content = readFileSync(CAPS_FILE, 'utf8');
    assert.ok(!content.includes('implement-code'), 'CAPABILITIES.md must not contain implement-code (specialist-only)');
  });

  test('no diff-review capability', () => {
    const content = readFileSync(CAPS_FILE, 'utf8');
    assert.ok(!content.includes('diff-review'), 'CAPABILITIES.md must not contain diff-review (specialist-only)');
  });
});

// ---------------------------------------------------------------------------
// TC-CAP-07: CAPABILITIES.md contains mem-longterm capabilities
// ---------------------------------------------------------------------------

describe('TC-CAP-07: CAPABILITIES.md contains mem-longterm capabilities', () => {
  test('mem-longterm-query_knowledge present', () => {
    const content = readFileSync(CAPS_FILE, 'utf8');
    assert.ok(content.includes('mem-longterm-query_knowledge'), 'CAPABILITIES.md must contain mem-longterm-query_knowledge');
  });

  test('mem-longterm-write_knowledge present', () => {
    const content = readFileSync(CAPS_FILE, 'utf8');
    assert.ok(content.includes('mem-longterm-write_knowledge'), 'CAPABILITIES.md must contain mem-longterm-write_knowledge');
  });
});

// ---------------------------------------------------------------------------
// TC-CAP-08: CONNECTORS.md contains sqlite3 binding for mem-longterm capabilities
// ---------------------------------------------------------------------------

describe('TC-CAP-08: CONNECTORS.md contains sqlite3 binding for mem-longterm capabilities', () => {
  test('sqlite3 appears in CONNECTORS.md mem-longterm sections', () => {
    const content = readFileSync(CONN_FILE, 'utf8');
    assert.ok(content.includes('sqlite3'), 'CONNECTORS.md must contain sqlite3 binding for mem-longterm capabilities');
  });
});

// ---------------------------------------------------------------------------
// TC-CAP-09: CONNECTORS.md contains telegram.sh reference for notify-human-send_status_update
// ---------------------------------------------------------------------------

describe('TC-CAP-09: CONNECTORS.md contains telegram.sh for notify-human-send_status_update', () => {
  test('telegram.sh reference present in CONNECTORS.md', () => {
    const content = readFileSync(CONN_FILE, 'utf8');
    assert.ok(content.includes('telegram.sh'), 'CONNECTORS.md must reference telegram.sh for notify-human-send_status_update');
  });
});
