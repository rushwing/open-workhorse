// Contract tests for RUNBOOK rendering pipeline
// TC-RNB-01 ~ TC-RNB-08
//
// External runtime requirement (not tested here):
//   everything_openclaw must be cloned at ~/workspace-pandas/everything_openclaw
//   before running `npm run runbook:render` in production.
//
// Adapter artifacts are validated against test/fixtures/runbook/,
// which are vendored copies of the version-controlled source of truth.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT = process.cwd();
const FIXTURE_DIR = join(PROJECT_ROOT, 'test', 'fixtures', 'runbook');
const ADAPTER_FILE = join(FIXTURE_DIR, 'RUNBOOK.adapter.yaml');
const ADAPTER_SCHEMA = join(FIXTURE_DIR, 'RUNBOOK.adapter.schema.yaml');
const RUNBOOK_RENDERING = join(FIXTURE_DIR, 'RUNBOOK_RENDERING.md');
const RENDER_SCRIPT = join(PROJECT_ROOT, 'scripts', 'render-runbook.sh');
const PKG_JSON = join(PROJECT_ROOT, 'package.json');

// ---------------------------------------------------------------------------
// TC-RNB-01: scripts/render-runbook.sh exists and is executable
// ---------------------------------------------------------------------------

describe('TC-RNB-01: scripts/render-runbook.sh exists and is executable', () => {
  test('render-runbook.sh exists', () => {
    assert.ok(existsSync(RENDER_SCRIPT), `scripts/render-runbook.sh must exist at ${RENDER_SCRIPT}`);
  });

  test('render-runbook.sh is executable', () => {
    const stat = statSync(RENDER_SCRIPT);
    const isExecutable = (stat.mode & 0o111) !== 0;
    assert.ok(isExecutable, 'scripts/render-runbook.sh must be executable (chmod +x)');
  });
});

// ---------------------------------------------------------------------------
// TC-RNB-02: fixture RUNBOOK.adapter.yaml exists (vendored contract copy)
// ---------------------------------------------------------------------------

describe('TC-RNB-02: test/fixtures/runbook/RUNBOOK.adapter.yaml exists', () => {
  test('fixture RUNBOOK.adapter.yaml exists', () => {
    assert.ok(
      existsSync(ADAPTER_FILE),
      `Fixture must exist at ${ADAPTER_FILE}\n` +
      `Update it from: everything_openclaw/personas/workspace-pandas/RUNBOOK.adapter.yaml`,
    );
  });
});

// ---------------------------------------------------------------------------
// TC-RNB-03: adapter contains all required bindings: PHASE_ROOT, REQ_ROOT, BUG_ROOT, TC_ROOT
// ---------------------------------------------------------------------------

describe('TC-RNB-03: adapter contains required path bindings', () => {
  const requiredBindings = ['PHASE_ROOT', 'REQ_ROOT', 'BUG_ROOT', 'TC_ROOT'];

  for (const binding of requiredBindings) {
    test(`${binding} present in adapter`, () => {
      const content = readFileSync(ADAPTER_FILE, 'utf8');
      assert.ok(
        content.includes(binding),
        `RUNBOOK.adapter.yaml must contain binding: ${binding}`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// TC-RNB-04: adapter agent_id is pandas
// ---------------------------------------------------------------------------

describe('TC-RNB-04: adapter agent_id is pandas', () => {
  test('agent_id: pandas', () => {
    const content = readFileSync(ADAPTER_FILE, 'utf8');
    assert.ok(content.includes('agent_id: pandas'), 'RUNBOOK.adapter.yaml must have agent_id: pandas');
  });
});

// ---------------------------------------------------------------------------
// TC-RNB-05: adapter team_role is engineering_orchestrator
// ---------------------------------------------------------------------------

describe('TC-RNB-05: adapter team_role is engineering_orchestrator', () => {
  test('team_role: engineering_orchestrator', () => {
    const content = readFileSync(ADAPTER_FILE, 'utf8');
    assert.ok(
      content.includes('team_role: engineering_orchestrator'),
      'RUNBOOK.adapter.yaml must have team_role: engineering_orchestrator',
    );
  });
});

// ---------------------------------------------------------------------------
// TC-RNB-06: fixture RUNBOOK.adapter.schema.yaml exists (vendored contract copy)
// ---------------------------------------------------------------------------

describe('TC-RNB-06: test/fixtures/runbook/RUNBOOK.adapter.schema.yaml exists', () => {
  test('fixture RUNBOOK.adapter.schema.yaml exists', () => {
    assert.ok(
      existsSync(ADAPTER_SCHEMA),
      `Fixture must exist at ${ADAPTER_SCHEMA}\n` +
      `Update it from: everything_openclaw/personas/workspace-pandas/RUNBOOK.adapter.schema.yaml`,
    );
  });
});

// ---------------------------------------------------------------------------
// TC-RNB-07: fixture RUNBOOK_RENDERING.md exists (vendored contract copy)
// ---------------------------------------------------------------------------

describe('TC-RNB-07: test/fixtures/runbook/RUNBOOK_RENDERING.md exists', () => {
  test('fixture RUNBOOK_RENDERING.md exists', () => {
    assert.ok(
      existsSync(RUNBOOK_RENDERING),
      `Fixture must exist at ${RUNBOOK_RENDERING}\n` +
      `Update it from: everything_openclaw/personas/workspace-pandas/RUNBOOK_RENDERING.md`,
    );
  });
});

// ---------------------------------------------------------------------------
// TC-RNB-08: npm run runbook:render script is defined in package.json
// ---------------------------------------------------------------------------

describe('TC-RNB-08: npm run runbook:render is defined in package.json', () => {
  test('runbook:render script present', () => {
    const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8'));
    assert.ok(
      pkg.scripts?.['runbook:render'],
      'package.json must define a "runbook:render" script',
    );
    assert.ok(
      (pkg.scripts['runbook:render'] as string).includes('render-runbook.sh'),
      '"runbook:render" script must reference render-runbook.sh',
    );
  });
});
