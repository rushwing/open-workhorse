import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  capabilityFamilyToCanonicalFamily,
  capabilityIdToCanonicalId,
} from '../src/agent-runtime/capabilities/schema.js';
import {
  getCapabilityDefinition,
  loadCapabilityRegistry,
} from '../src/agent-runtime/capabilities/registry.js';
import {
  getConnectorDefinition,
  loadConnectorRegistry,
} from '../src/agent-runtime/connectors/registry.js';

describe('agent runtime capability registry', () => {
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

  test('canonical naming is derived from the legacy three-part format', () => {
    assert.equal(capabilityIdToCanonicalId('ctx-request-read_human_intent'), 'ctx.request.read_human_intent');
    assert.equal(capabilityIdToCanonicalId('runtime-harness-worktree_setup'), 'runtime.harness.worktree_setup');
    assert.equal(capabilityFamilyToCanonicalFamily('mem-*'), 'mem.*');
  });
});

describe('agent runtime connector registry', () => {
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
