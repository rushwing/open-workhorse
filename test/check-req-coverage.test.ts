// Integration tests for scripts/check-req-coverage.sh — TC-029-01 ~ TC-029-09
// Pattern: create temp REQ fixtures, run shell script, assert exit code + output.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const PROJECT_ROOT = process.cwd();
const FEATURES_DIR = join(PROJECT_ROOT, 'tasks', 'features');
const BUGS_DIR = join(PROJECT_ROOT, 'tasks', 'bugs');
const SCRIPT = join(PROJECT_ROOT, 'scripts', 'check-req-coverage.sh');

// Unique run ID to avoid collisions with real REQ/BUG files
const RUN_ID = Date.now();

// Minimal legal REQ frontmatter builder
function makeReqContent(fields: Record<string, string>): string {
  const defaults: Record<string, string> = {
    title: 'Fixture REQ for TC-029',
    status: 'draft',
    priority: 'P1',
    phase: 'phase-2',
    owner: 'unassigned',
    depends_on: '[]',
    test_case_ref: '[]',
    tc_policy: 'optional',
    scope: 'docs',
    acceptance: 'fixture',
  };
  const merged = { ...defaults, ...fields };
  const lines = Object.entries(merged).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `---\n${lines}\n---\n\n# Fixture\n`;
}

function runScript(): { code: number; stdout: string } {
  const result = spawnSync('bash', [SCRIPT], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: { ...process.env, AGENT_ORCHESTRATOR: 'pandas', AGENT_CODER: 'menglan', AGENT_REVIEWER: 'huahua' },
  });
  return { code: result.status ?? 1, stdout: (result.stdout ?? '') + (result.stderr ?? '') };
}

// ---------------------------------------------------------------------------
// TC-029-01: status=review_ready accepted by STATUS_ENUM → exit 0
// ---------------------------------------------------------------------------

describe('TC-029-01: review_ready accepted by STATUS_ENUM', () => {
  const file = join(FEATURES_DIR, `REQ-F029-${RUN_ID}-01.md`);

  before(async () => {
    await writeFile(file, makeReqContent({ req_id: `REQ-F029-${RUN_ID}-01`, status: 'review_ready' }));
  });

  after(async () => { await rm(file, { force: true }); });

  test('exit 0 for status=review_ready', () => {
    const { code, stdout } = runScript();
    assert.equal(code, 0, `expected exit 0 but got ${code}\noutput:\n${stdout}`);
    assert.ok(!stdout.includes("review_ready' 不在允许枚举"), 'must not reject review_ready');
  });
});

// ---------------------------------------------------------------------------
// TC-029-02: status=review_wip rejected → exit 1
// ---------------------------------------------------------------------------

describe('TC-029-02: review_wip rejected by STATUS_ENUM', () => {
  const file = join(FEATURES_DIR, `REQ-F029-${RUN_ID}-02.md`);

  before(async () => {
    await writeFile(file, makeReqContent({ req_id: `REQ-F029-${RUN_ID}-02`, status: 'review_wip' }));
  });

  after(async () => { await rm(file, { force: true }); });

  test('exit 1 and enum error for status=review_wip', () => {
    const { code, stdout } = runScript();
    assert.equal(code, 1, `expected exit 1 but got ${code}`);
    assert.ok(stdout.includes("review_wip' 不在允许枚举"), `expected enum error:\n${stdout}`);
  });
});

// ---------------------------------------------------------------------------
// TC-029-03: pending_bugs=[] passes validation → exit 0
// ---------------------------------------------------------------------------

describe('TC-029-03: pending_bugs empty array passes validation', () => {
  const file = join(FEATURES_DIR, `REQ-F029-${RUN_ID}-03.md`);

  before(async () => {
    await writeFile(file, makeReqContent({
      req_id: `REQ-F029-${RUN_ID}-03`,
      pending_bugs: '[]',
    }));
  });

  after(async () => { await rm(file, { force: true }); });

  test('exit 0 with no pending_bugs error', () => {
    const { code, stdout } = runScript();
    assert.equal(code, 0, `expected exit 0 but got ${code}\noutput:\n${stdout}`);
    assert.ok(!stdout.includes('pending_bugs'), `unexpected pending_bugs error:\n${stdout}`);
  });
});

// ---------------------------------------------------------------------------
// TC-029-04: pending_bugs=[BUG-xxx] referencing existing bug file → exit 0
// ---------------------------------------------------------------------------

describe('TC-029-04: pending_bugs references existing BUG file', () => {
  const bugId = `BUG-F029-${RUN_ID}`;
  const reqFile = join(FEATURES_DIR, `REQ-F029-${RUN_ID}-04.md`);
  const bugFile = join(BUGS_DIR, `${bugId}.md`);

  before(async () => {
    await mkdir(BUGS_DIR, { recursive: true });
    await writeFile(bugFile, `---\nbug_id: ${bugId}\nstatus: open\n---\n`);
    await writeFile(reqFile, makeReqContent({
      req_id: `REQ-F029-${RUN_ID}-04`,
      pending_bugs: `[${bugId}]`,
    }));
  });

  after(async () => {
    await rm(reqFile, { force: true });
    await rm(bugFile, { force: true });
  });

  test('exit 0 when pending_bugs references existing bug', () => {
    const { code, stdout } = runScript();
    assert.equal(code, 0, `expected exit 0 but got ${code}\noutput:\n${stdout}`);
  });
});

// ---------------------------------------------------------------------------
// TC-029-05: pending_bugs=[BUG-999] referencing non-existent bug → exit 1
// ---------------------------------------------------------------------------

describe('TC-029-05: pending_bugs references non-existent BUG file', () => {
  const file = join(FEATURES_DIR, `REQ-F029-${RUN_ID}-05.md`);

  before(async () => {
    await writeFile(file, makeReqContent({
      req_id: `REQ-F029-${RUN_ID}-05`,
      pending_bugs: '[BUG-999]',
    }));
  });

  after(async () => { await rm(file, { force: true }); });

  test('exit 1 and error message for missing BUG-999', () => {
    const { code, stdout } = runScript();
    assert.equal(code, 1, `expected exit 1 but got ${code}`);
    assert.ok(
      stdout.includes('BUG-999') || stdout.includes('不存在') || stdout.includes('not found'),
      `expected error mentioning BUG-999:\n${stdout}`,
    );
  });
});

// ---------------------------------------------------------------------------
// TC-029-06: review_ready in requirement-standard.md §6.1
// ---------------------------------------------------------------------------

describe('TC-029-06: requirement-standard.md contains review_ready', () => {
  test('review_ready present in requirement-standard.md', () => {
    const r = spawnSync('grep', ['-q', 'review_ready', 'harness/requirement-standard.md'], {
      cwd: PROJECT_ROOT,
    });
    assert.equal(r.status, 0, 'review_ready must appear in requirement-standard.md (§6.1)');
  });
});

// ---------------------------------------------------------------------------
// TC-029-07: pending_bugs in requirement-standard.md §5.1
// ---------------------------------------------------------------------------

describe('TC-029-07: requirement-standard.md contains pending_bugs', () => {
  test('pending_bugs present in requirement-standard.md', () => {
    const r = spawnSync('grep', ['-q', 'pending_bugs', 'harness/requirement-standard.md'], {
      cwd: PROJECT_ROOT,
    });
    assert.equal(r.status, 0, 'pending_bugs must appear in requirement-standard.md (§5.1/§5.2)');
  });
});

// ---------------------------------------------------------------------------
// TC-029-08: draft→review_ready + state-as-lock in requirement-standard.md §6.2
// ---------------------------------------------------------------------------

describe('TC-029-08: requirement-standard.md contains review_ready transitions and state-as-lock', () => {
  test('review_ready transition present', () => {
    const r = spawnSync('grep', ['-q', 'review_ready', 'harness/requirement-standard.md'], {
      cwd: PROJECT_ROOT,
    });
    assert.equal(r.status, 0, 'review_ready must appear in requirement-standard.md (§6.2 transitions)');
  });

  test('state-as-lock or 原子 present in requirement-standard.md', () => {
    const r = spawnSync(
      'bash', ['-c', 'grep -q "state-as-lock\\|原子" harness/requirement-standard.md'],
      { cwd: PROJECT_ROOT },
    );
    assert.equal(r.status, 0, 'requirement-standard.md must document state-as-lock or 原子 commit');
  });
});

// ---------------------------------------------------------------------------
// TC-029-09: docs/req-flow.html — 9 state nodes + 6 semantic labels + no CDN
// ---------------------------------------------------------------------------

describe('TC-029-09: docs/req-flow.html structure', () => {
  const HTML = 'docs/req-flow.html';

  test('Group A — file exists', () => {
    const r = spawnSync('test', ['-f', HTML], { cwd: PROJECT_ROOT });
    assert.equal(r.status, 0, `${HTML} must exist`);
  });

  const stateNodes = [
    'draft', 'review_ready', 'req_review', 'ready', 'test_designed',
    'in_progress', 'blocked', 'review', 'done',
  ];
  for (const state of stateNodes) {
    test(`Group B — state node "${state}" present`, () => {
      const r = spawnSync('grep', ['-q', state, HTML], { cwd: PROJECT_ROOT });
      assert.equal(r.status, 0, `"${state}" must appear in ${HTML}`);
    });
  }

  const semanticLabels = ['state-as-lock', 'pending_bugs', 'Bug clean', 'Huahua', 'Menglan', 'Pandas'];
  for (const label of semanticLabels) {
    test(`Group C — semantic label "${label}" present`, () => {
      const r = spawnSync('grep', ['-q', label, HTML], { cwd: PROJECT_ROOT });
      assert.equal(r.status, 0, `"${label}" must appear in ${HTML}`);
    });
  }

  test('Group D — no external CDN references', () => {
    const r = spawnSync(
      'bash', ['-c', `grep -q 'http://' ${HTML} || grep -q 'https://' ${HTML}`],
      { cwd: PROJECT_ROOT },
    );
    assert.equal(r.status, 1, `${HTML} must not contain http:// or https:// (no CDN)`);
  });
});
