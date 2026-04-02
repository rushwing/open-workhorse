import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertCapabilitySideEffect,
  assertLegacyCapabilityId,
} from '../capabilities/schema';
import {
  assertConnectorBackend,
  type ConnectorDefinition,
  type RawConnectorDefinition,
} from './schema';
import {
  getCapabilityDefinition,
  loadCapabilityRegistry,
  type CapabilityRegistry,
} from '../capabilities/registry';
import { registerUnique } from '../shared/registry-map';
import { normalizeStringList, parseSimpleYaml } from '../shared/simple-yaml';

export interface ConnectorRegistry {
  entries: ConnectorDefinition[];
  byBindingId: Map<string, ConnectorDefinition>;
  // This map intentionally supports lookup by both legacy capability ids and
  // canonical capability ids, so the key count is expected to be 2x entries.
  byCapabilityId: Map<string, ConnectorDefinition>;
}

const SPEC_BLOCK_RE = /^### `([^`]+)`\s*\n\n```yaml\n([\s\S]*?)\n```/gm;

export function loadConnectorRegistry(
  projectRoot = process.cwd(),
  capabilityRegistry = loadCapabilityRegistry(projectRoot),
): ConnectorRegistry {
  const sourcePath = join(projectRoot, 'harness', 'CONNECTORS.md');
  const content = readFileSync(sourcePath, 'utf8');
  const entries: ConnectorDefinition[] = [];

  for (const match of content.matchAll(SPEC_BLOCK_RE)) {
    const heading = match[1] ?? '';
    const yamlBlock = match[2] ?? '';
    const parsed = parseSimpleYaml(yamlBlock) as unknown as RawConnectorDefinition;
    const context = `CONNECTORS.md:${heading}`;
    const capabilityLegacyId = assertLegacyCapabilityId(parsed.capability, context);

    if (capabilityLegacyId !== heading) {
      throw new Error(`${context}: heading and capability field do not match`);
    }

    const capability = getCapabilityDefinition(capabilityRegistry, capabilityLegacyId);
    if (!capability) {
      throw new Error(`${context}: missing capability definition for ${capabilityLegacyId}`);
    }
    const backend = assertConnectorBackend(parsed.backend, context);
    if (typeof parsed.driver !== 'string' || parsed.driver.trim() === '') {
      throw new Error(`${context}: driver must be a non-empty string`);
    }
    if (typeof parsed.entrypoint !== 'string' || parsed.entrypoint.trim() === '') {
      throw new Error(`${context}: entrypoint must be a non-empty string`);
    }
    if (typeof parsed.approval_mode !== 'string' || parsed.approval_mode.trim() === '') {
      throw new Error(`${context}: approval_mode must be a non-empty string`);
    }

    entries.push({
      bindingId: `connector.${backend}.${capability.canonicalId}`,
      capabilityLegacyId,
      capabilityCanonicalId: capability.canonicalId,
      capability,
      backend,
      driver: String(parsed.driver).trim(),
      entrypoint: String(parsed.entrypoint).trim(),
      requires: normalizeStringList(parsed.requires),
      returns: normalizeStringList(parsed.returns),
      sideEffect: assertCapabilitySideEffect(parsed.side_effect, context),
      approvalMode: String(parsed.approval_mode).trim(),
      notes: normalizeStringList(parsed.notes),
      sourceHeading: heading,
      sourcePath,
    });
  }

  if (entries.length === 0) {
    throw new Error('CONNECTORS.md: no connector spec blocks were loaded');
  }

  const byBindingId = new Map<string, ConnectorDefinition>();
  const byCapabilityId = new Map<string, ConnectorDefinition>();

  for (const entry of entries) {
    registerUnique(byBindingId, entry.bindingId, entry, 'connector binding id');
    // Phase 1 intentionally models one active connector binding per capability.
    // If later phases need multiple bindings per capability, this map should
    // become a fan-out structure rather than silently overwriting entries.
    registerUnique(byCapabilityId, entry.capabilityLegacyId, entry, 'connector capability');
    registerUnique(byCapabilityId, entry.capabilityCanonicalId, entry, 'connector capability');
  }

  return { entries, byBindingId, byCapabilityId };
}

export function getConnectorDefinition(
  registry: ConnectorRegistry,
  capabilityId: string,
): ConnectorDefinition | undefined {
  return registry.byCapabilityId.get(capabilityId);
}
