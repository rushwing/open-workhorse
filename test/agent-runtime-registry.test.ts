import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  capabilityFamilyToCanonicalFamily,
  capabilityIdToCanonicalId,
} from '../src/agent-runtime/capabilities/schema.js';
import {
  getCapabilityDefinition,
  loadCapabilityRegistry,
} from '../src/agent-runtime/capabilities/registry.js';
import {
  assertConnectorBackend,
} from '../src/agent-runtime/connectors/schema.js';
import {
  getConnectorDefinition,
  loadConnectorRegistry,
} from '../src/agent-runtime/connectors/registry.js';

describe('agent runtime capability registry', () => {
  let fixtureRoot: string;

  before(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'agent-runtime-registry-'));
    await mkdir(join(fixtureRoot, 'harness'), { recursive: true });
    await writeFile(
      join(fixtureRoot, 'harness', 'CAPABILITIES.md'),
      `# Fixture

### \`ctx-request-read_human_intent\`

\`\`\`yaml
capability: ctx-request-read_human_intent
family: ctx-*
default_enabled: true
side_effect: none
aliases:
  - ctx.request.readHumanIntent
  - human-intent-read
inputs:
  - human request
outputs:
  - routing intent
use_when:
  - intake
avoid_when:
  - already classified
notes:
  - fixture
\`\`\`
`,
      'utf8',
    );
  });

  after(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  test('loads capability definitions from CAPABILITIES.md', () => {
    const registry = loadCapabilityRegistry(process.cwd());
    assert.ok(
      registry.entries.length > 20,
      'expected at least 21 capabilities to load from CAPABILITIES.md',
    );

    const capability = getCapabilityDefinition(registry, 'workflow-task-transition_state');
    assert.ok(capability);
    assert.equal(capability?.canonicalId, 'workflow.task.transition_state');
    assert.equal(capability?.canonicalFamily, 'workflow.*');
    assert.equal(capability?.sideEffect, 'local_write');
  });

  test('legacy and canonical ids both resolve to the same definition', () => {
    const registry = loadCapabilityRegistry(process.cwd());
    const byLegacy = getCapabilityDefinition(registry, 'agent-inbox-read_result_packet');
    const byCanonical = getCapabilityDefinition(registry, 'agent.inbox.read_result_packet');
    assert.ok(byLegacy);
    assert.equal(byLegacy, byCanonical);
  });

  test('explicit aliases from markdown are loaded into the lookup map', () => {
    const registry = loadCapabilityRegistry(fixtureRoot);
    const byAlias = getCapabilityDefinition(registry, 'ctx.request.readHumanIntent');
    const byLegacy = getCapabilityDefinition(registry, 'ctx-request-read_human_intent');

    assert.ok(byAlias);
    assert.equal(byAlias, byLegacy);
    assert.deepEqual(byLegacy?.aliases, ['ctx.request.readHumanIntent', 'human-intent-read']);
  });

  test('canonical naming is derived from the legacy three-part format', () => {
    assert.equal(capabilityIdToCanonicalId('ctx-request-read_human_intent'), 'ctx.request.read_human_intent');
    assert.equal(capabilityIdToCanonicalId('runtime-harness-worktree_setup'), 'runtime.harness.worktree_setup');
    assert.equal(capabilityFamilyToCanonicalFamily('mem-*'), 'mem.*');
  });
});

describe('agent runtime connector registry', () => {
  test('backend names must remain binding-id safe', () => {
    assert.equal(assertConnectorBackend('cli', 'test'), 'cli');
    assert.throws(
      () => assertConnectorBackend('direct user message', 'test'),
      /invalid backend/,
    );
  });

  test('loads connector definitions and links them to capabilities', () => {
    const capabilityRegistry = loadCapabilityRegistry(process.cwd());
    const connectorRegistry = loadConnectorRegistry(process.cwd(), capabilityRegistry);
    assert.ok(
      connectorRegistry.entries.length > 20,
      'expected at least 21 connectors to load from CONNECTORS.md',
    );

    const connector = getConnectorDefinition(connectorRegistry, 'gh-pr-read_metadata');
    assert.ok(connector);
    assert.equal(connector?.capabilityCanonicalId, 'gh.pr.read_metadata');
    assert.equal(connector?.bindingId, 'connector.cli.gh.pr.read_metadata');
    assert.equal(connector?.backend, 'cli');
  });

  test('connector lookup accepts canonical capability ids', () => {
    const capabilityRegistry = loadCapabilityRegistry(process.cwd());
    const connectorRegistry = loadConnectorRegistry(process.cwd(), capabilityRegistry);
    const connector = getConnectorDefinition(connectorRegistry, 'notify.human.send_status_update');
    assert.ok(connector);
    assert.equal(connector?.approvalMode, 'human_required');
  });
});
