// Contract tests for memory initialization infrastructure
// TC-MEM-01 ~ TC-MEM-09
//
// External runtime requirement (not tested here):
//   everything_openclaw must be cloned at ~/workspace-pandas/everything_openclaw
//   before running `npm run memory:init` in production.
//
// Schema content is validated against test/fixtures/memory/schema.sql,
// which is a vendored copy of the version-controlled source of truth.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT = process.cwd();
const FIXTURE_SCHEMA = join(PROJECT_ROOT, 'test', 'fixtures', 'memory', 'schema.sql');
const INIT_SCRIPT = join(PROJECT_ROOT, 'scripts', 'init-memory.sh');
const MEM_ARCH = join(PROJECT_ROOT, 'harness', 'memory-architecture.md');
const PKG_JSON = join(PROJECT_ROOT, 'package.json');

// ---------------------------------------------------------------------------
// TC-MEM-01: scripts/init-memory.sh exists and is executable
// ---------------------------------------------------------------------------

describe('TC-MEM-01: scripts/init-memory.sh exists and is executable', () => {
  test('init-memory.sh exists', () => {
    assert.ok(existsSync(INIT_SCRIPT), `scripts/init-memory.sh must exist at ${INIT_SCRIPT}`);
  });

  test('init-memory.sh is executable', () => {
    const stat = statSync(INIT_SCRIPT);
    const isExecutable = (stat.mode & 0o111) !== 0;
    assert.ok(isExecutable, 'scripts/init-memory.sh must be executable (chmod +x)');
  });
});

// ---------------------------------------------------------------------------
// TC-MEM-02: fixture schema.sql exists (vendored contract copy)
// ---------------------------------------------------------------------------

describe('TC-MEM-02: test/fixtures/memory/schema.sql exists', () => {
  test('fixture schema.sql exists', () => {
    assert.ok(
      existsSync(FIXTURE_SCHEMA),
      `Fixture schema.sql must exist at ${FIXTURE_SCHEMA}\n` +
      `Update it from: everything_openclaw/personas/workspace-pandas/memory/long-term/schema.sql`,
    );
  });
});

// ---------------------------------------------------------------------------
// TC-MEM-03: schema.sql contains CREATE TABLE IF NOT EXISTS project_facts
// ---------------------------------------------------------------------------

describe('TC-MEM-03: schema.sql contains project_facts table', () => {
  test('project_facts table defined', () => {
    const content = readFileSync(FIXTURE_SCHEMA, 'utf8');
    assert.ok(
      content.includes('CREATE TABLE IF NOT EXISTS project_facts'),
      'schema.sql must contain CREATE TABLE IF NOT EXISTS project_facts',
    );
  });
});

// ---------------------------------------------------------------------------
// TC-MEM-04: schema.sql contains CREATE TABLE IF NOT EXISTS decisions
// ---------------------------------------------------------------------------

describe('TC-MEM-04: schema.sql contains decisions table', () => {
  test('decisions table defined', () => {
    const content = readFileSync(FIXTURE_SCHEMA, 'utf8');
    assert.ok(
      content.includes('CREATE TABLE IF NOT EXISTS decisions'),
      'schema.sql must contain CREATE TABLE IF NOT EXISTS decisions',
    );
  });
});

// ---------------------------------------------------------------------------
// TC-MEM-05: schema.sql contains CREATE TABLE IF NOT EXISTS patterns
// ---------------------------------------------------------------------------

describe('TC-MEM-05: schema.sql contains patterns table', () => {
  test('patterns table defined', () => {
    const content = readFileSync(FIXTURE_SCHEMA, 'utf8');
    assert.ok(
      content.includes('CREATE TABLE IF NOT EXISTS patterns'),
      'schema.sql must contain CREATE TABLE IF NOT EXISTS patterns',
    );
  });
});

// ---------------------------------------------------------------------------
// TC-MEM-06: schema.sql contains CREATE TABLE IF NOT EXISTS candidates
// ---------------------------------------------------------------------------

describe('TC-MEM-06: schema.sql contains candidates table', () => {
  test('candidates table defined', () => {
    const content = readFileSync(FIXTURE_SCHEMA, 'utf8');
    assert.ok(
      content.includes('CREATE TABLE IF NOT EXISTS candidates'),
      'schema.sql must contain CREATE TABLE IF NOT EXISTS candidates',
    );
  });
});

// ---------------------------------------------------------------------------
// TC-MEM-07: candidates table has status CHECK constraint with pending/accepted/rejected
// ---------------------------------------------------------------------------

describe('TC-MEM-07: candidates table has status CHECK constraint', () => {
  test("status CHECK includes 'pending', 'accepted', 'rejected'", () => {
    const content = readFileSync(FIXTURE_SCHEMA, 'utf8');
    assert.ok(content.includes("'pending'"), "schema.sql candidates status CHECK must include 'pending'");
    assert.ok(content.includes("'accepted'"), "schema.sql candidates status CHECK must include 'accepted'");
    assert.ok(content.includes("'rejected'"), "schema.sql candidates status CHECK must include 'rejected'");
  });
});

// ---------------------------------------------------------------------------
// TC-MEM-08: harness/memory-architecture.md exists and contains project_facts
// ---------------------------------------------------------------------------

describe('TC-MEM-08: harness/memory-architecture.md exists and contains project_facts', () => {
  test('memory-architecture.md exists', () => {
    assert.ok(existsSync(MEM_ARCH), `harness/memory-architecture.md must exist at ${MEM_ARCH}`);
  });

  test('memory-architecture.md contains project_facts', () => {
    const content = readFileSync(MEM_ARCH, 'utf8');
    assert.ok(content.includes('project_facts'), 'harness/memory-architecture.md must contain project_facts');
  });
});

// ---------------------------------------------------------------------------
// TC-MEM-09: npm run memory:init script is defined in package.json
// ---------------------------------------------------------------------------

describe('TC-MEM-09: npm run memory:init is defined in package.json', () => {
  test('memory:init script present', () => {
    const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8'));
    assert.ok(
      pkg.scripts?.['memory:init'],
      'package.json must define a "memory:init" script',
    );
    assert.ok(
      (pkg.scripts['memory:init'] as string).includes('init-memory.sh'),
      '"memory:init" script must reference init-memory.sh',
    );
  });
});
