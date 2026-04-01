/**
 * Tests for REQ-042: ATM Envelope types + REQ Frontmatter parsing + Inbox I/O
 * TC-042-01 through TC-042-12
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  generateMessageId,
  generateThreadId,
  generateCorrelationId,
  type RequestEnvelope,
  type AgentName,
} from '../src/contracts/inbox-envelope.js';

import {
  parseReqFrontmatter,
  patchReqFrontmatter,
} from '../src/contracts/req-frontmatter.js';

import {
  inboxInit,
  inboxWrite,
  inboxClaim,
  inboxFinalize,
  inboxReadLegacy,
} from '../src/lib/inbox-io.js';

// ---------------------------------------------------------------------------
// TC-042-01: generateMessageId format
// ---------------------------------------------------------------------------

describe('TC-042-01: generateMessageId format', () => {
  test('returns msg_pandas_<14digits>_<4hex> format', () => {
    const id = generateMessageId('pandas');
    assert.match(id, /^msg_pandas_\d{14}_[0-9a-f]{4}$/);
  });

  test('timestamp is within 2 seconds of current UTC time', () => {
    const before = new Date();
    const id = generateMessageId('pandas');
    const after = new Date();

    const tsPart = id.slice('msg_pandas_'.length, 'msg_pandas_'.length + 14);
    const year = parseInt(tsPart.slice(0, 4));
    const month = parseInt(tsPart.slice(4, 6)) - 1;
    const day = parseInt(tsPart.slice(6, 8));
    const hour = parseInt(tsPart.slice(8, 10));
    const min = parseInt(tsPart.slice(10, 12));
    const sec = parseInt(tsPart.slice(12, 14));
    const tsDate = new Date(Date.UTC(year, month, day, hour, min, sec));

    assert.ok(tsDate >= new Date(before.getTime() - 2000));
    assert.ok(tsDate <= new Date(after.getTime() + 2000));
  });

  test('consecutive calls return different values (rand4 randomness)', () => {
    const id1 = generateMessageId('pandas');
    // Small chance of collision; retry logic not needed for test purposes
    let id2 = generateMessageId('pandas');
    // In the rare case of collision, try once more
    if (id1 === id2) id2 = generateMessageId('pandas');
    // With 4 hex digits (65536 possibilities), collision probability is ~1.5e-5
    assert.notEqual(id1, id2);
  });

  test('works for all agent names', () => {
    for (const agent of ['pandas', 'menglan', 'huahua'] as AgentName[]) {
      const id = generateMessageId(agent);
      const pattern = new RegExp(`^msg_${agent}_\\d{14}_[0-9a-f]{4}$`);
      assert.match(id, pattern);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-042-11: generateThreadId format
// ---------------------------------------------------------------------------

describe('TC-042-11: generateThreadId format', () => {
  test('returns thread_REQ-042_<10digits> format', () => {
    const id = generateThreadId('REQ-042');
    assert.match(id, /^thread_REQ-042_\d{10}$/);
  });

  test('epoch is within 2 seconds of current time', () => {
    const before = Math.floor(Date.now() / 1000);
    const id = generateThreadId('REQ-042');
    const after = Math.floor(Date.now() / 1000);
    const epoch = parseInt(id.slice('thread_REQ-042_'.length));
    assert.ok(epoch >= before - 2);
    assert.ok(epoch <= after + 2);
  });

  test('same req_id produces same thread prefix (deterministic except epoch)', () => {
    const id = generateThreadId('REQ-042');
    assert.ok(id.startsWith('thread_REQ-042_'));
  });
});

// ---------------------------------------------------------------------------
// TC-042-12: generateCorrelationId format
// ---------------------------------------------------------------------------

describe('TC-042-12: generateCorrelationId format', () => {
  test('returns corr_REQ-042_<10digits>_<4hex> format', () => {
    const id = generateCorrelationId('REQ-042');
    assert.match(id, /^corr_REQ-042_\d{10}_[0-9a-f]{4}$/);
  });

  test('epoch is within 2 seconds of current time', () => {
    const before = Math.floor(Date.now() / 1000);
    const id = generateCorrelationId('REQ-042');
    const after = Math.floor(Date.now() / 1000);
    const parts = id.split('_');
    const epoch = parseInt(parts[parts.length - 2]);
    assert.ok(epoch >= before - 2);
    assert.ok(epoch <= after + 2);
  });

  test('consecutive calls return different values (rand4 randomness)', () => {
    const id1 = generateCorrelationId('REQ-042');
    let id2 = generateCorrelationId('REQ-042');
    if (id1 === id2) id2 = generateCorrelationId('REQ-042');
    assert.notEqual(id1, id2);
  });
});

// ---------------------------------------------------------------------------
// Inbox I/O tests (TC-042-02 through TC-042-06, TC-042-09, TC-042-10)
// ---------------------------------------------------------------------------

describe('Inbox I/O tests', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'req042-test-'));
    await inboxInit(tmpDir);
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeRequestEnvelope(overrides: Partial<RequestEnvelope> = {}): RequestEnvelope {
    return {
      message_id: generateMessageId('pandas'),
      type: 'request',
      from: 'pandas',
      to: 'menglan',
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      thread_id: generateThreadId('REQ-042'),
      correlation_id: generateCorrelationId('REQ-042'),
      priority: 'P1',
      action: 'implement',
      response_required: true,
      objective: 'Implement REQ-042 base layer',
      scope: 'runtime',
      expected_output: 'TypeScript files in src/contracts/ and src/lib/',
      done_criteria: 'npm test passes',
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // TC-042-02: inboxWrite writes file with all required Envelope fields
  // -------------------------------------------------------------------------

  test('TC-042-02: inboxWrite writes file with all required Envelope fields', async () => {
    const envelope = makeRequestEnvelope();
    const filePath = await inboxWrite(tmpDir, 'menglan', envelope);

    assert.ok(typeof filePath === 'string');
    assert.ok(existsSync(filePath), `File should exist at ${filePath}`);
    assert.ok(filePath.includes('pending'), 'File should be in pending/ directory');

    const content = await readFile(filePath, 'utf8');
    assert.ok(content.startsWith('---'), 'File should start with --- (YAML frontmatter)');
    assert.ok(content.includes(`message_id: ${envelope.message_id}`));
    assert.ok(content.includes('type: request'));
    assert.ok(content.includes('from: pandas'));
    assert.ok(content.includes('to: menglan'));
    assert.ok(content.includes('created_at:'));
    assert.ok(content.includes('thread_id:'));
    assert.ok(content.includes('correlation_id:'));
    assert.ok(content.includes('priority: P1'));
    assert.ok(content.includes('action: implement'));
    assert.ok(content.includes('response_required: true'));
    assert.ok(content.includes('objective:'));
    assert.ok(content.includes('scope:'));
    assert.ok(content.includes('expected_output:'));
    assert.ok(content.includes('done_criteria:'));
  });

  // -------------------------------------------------------------------------
  // TC-042-03: inboxClaim atomic mv; concurrent claims only one succeeds
  // -------------------------------------------------------------------------

  test('TC-042-03: inboxClaim atomic mv, concurrent calls only one succeeds', async () => {
    // Use a fresh sub-tmpdir for isolation
    const subDir = await mkdtemp(join(tmpdir(), 'req042-tc03-'));
    try {
      await inboxInit(subDir);
      const envelope = makeRequestEnvelope({ message_id: generateMessageId('pandas') });
      await inboxWrite(subDir, 'menglan', envelope);

      // Concurrent claims
      const [r1, r2] = await Promise.all([
        inboxClaim(subDir, 'menglan'),
        inboxClaim(subDir, 'menglan'),
      ]);

      const successes = [r1, r2].filter((r) => r !== null);
      const nulls = [r1, r2].filter((r) => r === null);

      assert.equal(successes.length, 1, 'Exactly one claim should succeed');
      assert.equal(nulls.length, 1, 'Exactly one claim should return null');

      const claimed = successes[0]!;
      assert.ok(claimed.path.includes('claimed'), 'Claimed file should be in claimed/ directory');
      assert.ok(existsSync(claimed.path), 'Claimed file should exist');
      assert.equal(claimed.envelope.message_id, envelope.message_id);

      // Pending file should no longer exist
      const pendingPath = join(subDir, 'inbox', 'for-menglan', 'pending', `${envelope.message_id}.md`);
      assert.ok(!existsSync(pendingPath), 'Pending file should no longer exist');
    } finally {
      await rm(subDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // TC-042-04: inboxClaim returns null when no messages
  // -------------------------------------------------------------------------

  test('TC-042-04: inboxClaim returns null when no messages pending', async () => {
    const subDir = await mkdtemp(join(tmpdir(), 'req042-tc04-'));
    try {
      await inboxInit(subDir);
      const result = await inboxClaim(subDir, 'menglan');
      assert.equal(result, null);
    } finally {
      await rm(subDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // TC-042-05: inboxFinalize(done) moves file to done/
  // -------------------------------------------------------------------------

  test('TC-042-05: inboxFinalize(done) moves claimed file to done/', async () => {
    const subDir = await mkdtemp(join(tmpdir(), 'req042-tc05-'));
    try {
      await inboxInit(subDir);
      const envelope = makeRequestEnvelope({ message_id: generateMessageId('pandas') });
      await inboxWrite(subDir, 'menglan', envelope);
      const claimed = await inboxClaim(subDir, 'menglan');
      assert.ok(claimed !== null);

      await inboxFinalize(claimed.path, 'done');

      assert.ok(!existsSync(claimed.path), 'Claimed file should no longer exist');
      const donePath = claimed.path.replace('/claimed/', '/done/');
      assert.ok(existsSync(donePath), 'File should exist in done/ directory');
    } finally {
      await rm(subDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // TC-042-06: inboxFinalize(failed) moves file to failed/ with error summary
  // -------------------------------------------------------------------------

  test('TC-042-06: inboxFinalize(failed) moves file to failed/ with error summary', async () => {
    const subDir = await mkdtemp(join(tmpdir(), 'req042-tc06-'));
    try {
      await inboxInit(subDir);
      const envelope = makeRequestEnvelope({ message_id: generateMessageId('pandas') });
      await inboxWrite(subDir, 'menglan', envelope);
      const claimed = await inboxClaim(subDir, 'menglan');
      assert.ok(claimed !== null);

      const errorSummary = '处理失败：缺少必要字段';
      await inboxFinalize(claimed.path, 'failed', errorSummary);

      assert.ok(!existsSync(claimed.path), 'Claimed file should no longer exist');
      const failedPath = claimed.path.replace('/claimed/', '/failed/');
      assert.ok(existsSync(failedPath), 'File should exist in failed/ directory');

      const content = await readFile(failedPath, 'utf8');
      assert.ok(content.includes(errorSummary), 'File should contain the error summary');
    } finally {
      await rm(subDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // TC-042-09: inboxReadLegacy parses legacy format (no type field)
  // -------------------------------------------------------------------------

  test('TC-042-09: inboxReadLegacy parses legacy format file', async () => {
    const legacyContent = `---
message_id: msg_pandas_20260301120000_abcd
from: pandas
to: menglan
action: implement
req_id: REQ-001
---
`;
    const legacyFile = join(tmpDir, 'legacy-msg.md');
    await writeFile(legacyFile, legacyContent, 'utf8');

    const result = await inboxReadLegacy(legacyFile);
    assert.ok(result !== null);
    assert.equal(result.message_id, 'msg_pandas_20260301120000_abcd');
    assert.equal(result.from, 'pandas');
    assert.equal(result.to, 'menglan');
    assert.equal(result.action, 'implement');
    assert.equal(result.req_id, 'REQ-001');
  });

  test('TC-042-09: inboxReadLegacy returns null for nonexistent file', async () => {
    const result = await inboxReadLegacy('/nonexistent/path/msg.md');
    assert.equal(result, null);
  });

  // -------------------------------------------------------------------------
  // TC-042-10: RequestEnvelope with missing delegation fields sets delegation_incomplete=true
  // -------------------------------------------------------------------------

  test('TC-042-10: missing objective sets delegation_incomplete=true in written file', async () => {
    const subDir = await mkdtemp(join(tmpdir(), 'req042-tc10-'));
    try {
      await inboxInit(subDir);

      const envelope = makeRequestEnvelope({ objective: '' });
      const filePath = await inboxWrite(subDir, 'menglan', envelope);
      const content = await readFile(filePath, 'utf8');
      assert.ok(content.includes('delegation_incomplete: true'));
    } finally {
      await rm(subDir, { recursive: true, force: true });
    }
  });

  test('TC-042-10: complete envelope does not set delegation_incomplete=true', async () => {
    const subDir = await mkdtemp(join(tmpdir(), 'req042-tc10b-'));
    try {
      await inboxInit(subDir);
      const envelope = makeRequestEnvelope();
      const filePath = await inboxWrite(subDir, 'menglan', envelope);
      const content = await readFile(filePath, 'utf8');
      assert.ok(
        !content.includes('delegation_incomplete: true'),
        'Complete envelope should not have delegation_incomplete: true'
      );
    } finally {
      await rm(subDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// REQ Frontmatter tests (TC-042-07, TC-042-08)
// ---------------------------------------------------------------------------

describe('REQ Frontmatter tests', () => {
  // -------------------------------------------------------------------------
  // TC-042-07: parseReqFrontmatter parses real REQ-033.md
  // -------------------------------------------------------------------------

  test('TC-042-07: parseReqFrontmatter parses real REQ-033.md', async () => {
    const reqPath = join(process.cwd(), 'tasks', 'features', 'REQ-033.md');
    const fm = await parseReqFrontmatter(reqPath);

    assert.equal(fm.req_id, 'REQ-033');
    assert.ok(
      ['draft', 'ready', 'review_ready', 'test_designed', 'in_progress', 'review', 'blocked', 'done'].includes(
        fm.status
      ),
      `status "${fm.status}" should be a valid ReqStatus`
    );
    assert.ok(Array.isArray(fm.depends_on), 'depends_on should be an array');
    assert.ok(Array.isArray(fm.test_case_ref), 'test_case_ref should be an array');
    assert.ok(
      ['P0', 'P1', 'P2', 'P3'].includes(fm.priority),
      `priority "${fm.priority}" should be P0-P3`
    );
    assert.ok(Array.isArray(fm.pending_bugs), 'pending_bugs should be an array');
  });

  // -------------------------------------------------------------------------
  // TC-042-08: patchReqFrontmatter updates fields, body preserved
  // -------------------------------------------------------------------------

  test('TC-042-08: patchReqFrontmatter updates status, body and other fields unchanged', async () => {
    const tmpDir2 = await mkdtemp(join(tmpdir(), 'req042-tc08-'));
    try {
      const tmpFile = join(tmpDir2, 'REQ-test.md');
      const originalContent = `---
req_id: REQ-TEST
title: "Test Requirement"
status: ready
priority: P2
phase: phase-1
owner: huahua
blocked_reason: ""
blocked_from_status: ""
blocked_from_owner: ""
depends_on: []
test_case_ref: [TC-001]
tc_policy: required
tc_exempt_reason: ""
scope: runtime
acceptance: >
  This is the acceptance criteria.
pending_bugs: []
---

# Goal

This is the markdown body.

## Section

More content here.
`;
      await writeFile(tmpFile, originalContent, 'utf8');

      await patchReqFrontmatter(tmpFile, { status: 'in_progress', owner: 'menglan' });

      const fm = await parseReqFrontmatter(tmpFile);
      assert.equal(fm.status, 'in_progress');
      assert.equal(fm.owner, 'menglan');
      assert.equal(fm.title, 'Test Requirement');
      assert.equal(fm.priority, 'P2');

      const newContent = await readFile(tmpFile, 'utf8');
      assert.ok(newContent.startsWith('---'), 'File should still start with ---');
      assert.ok(newContent.includes('# Goal'), 'Body should be preserved');
      assert.ok(newContent.includes('This is the markdown body.'), 'Body content should be preserved');
      assert.ok(newContent.includes('More content here.'), 'Body section should be preserved');
    } finally {
      await rm(tmpDir2, { recursive: true, force: true });
    }
  });
});
