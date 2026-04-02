import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertCapabilitySideEffect,
  assertLegacyCapabilityFamily,
  assertLegacyCapabilityId,
  capabilityFamilyToCanonicalFamily,
  capabilityIdToCanonicalId,
  type CapabilityDefinition,
  type RawCapabilityDefinition,
} from './schema.js';
import { normalizeStringList, parseSimpleYaml } from '../shared/simple-yaml.js';
import { registerUnique } from '../shared/registry-map.js';

export interface CapabilityRegistry {
  entries: CapabilityDefinition[];
  byLegacyId: Map<string, CapabilityDefinition>;
  byCanonicalId: Map<string, CapabilityDefinition>;
  byLookupKey: Map<string, CapabilityDefinition>;
}

const SPEC_BLOCK_RE = /^### `([^`]+)`\s*\n\n```yaml\n([\s\S]*?)\n```/gm;

export function loadCapabilityRegistry(projectRoot = process.cwd()): CapabilityRegistry {
  const sourcePath = join(projectRoot, 'harness', 'CAPABILITIES.md');
  const content = readFileSync(sourcePath, 'utf8');

  const entries: CapabilityDefinition[] = [];
  for (const match of content.matchAll(SPEC_BLOCK_RE)) {
    const heading = match[1] ?? '';
    const yamlBlock = match[2] ?? '';
    const parsed = parseSimpleYaml(yamlBlock) as unknown as RawCapabilityDefinition;
    const context = `CAPABILITIES.md:${heading}`;
    const legacyId = assertLegacyCapabilityId(parsed.capability, context);

    if (legacyId !== heading) {
      throw new Error(`${context}: heading and capability field do not match`);
    }

    const legacyFamily = assertLegacyCapabilityFamily(parsed.family, context);
    if (typeof parsed.default_enabled !== 'boolean') {
      throw new Error(`${context}: default_enabled must be boolean`);
    }

    const entry: CapabilityDefinition = {
      legacyId,
      canonicalId: capabilityIdToCanonicalId(legacyId),
      aliases: normalizeStringList(parsed.aliases),
      legacyFamily,
      canonicalFamily: capabilityFamilyToCanonicalFamily(legacyFamily),
      defaultEnabled: parsed.default_enabled,
      sideEffect: assertCapabilitySideEffect(parsed.side_effect, context),
      inputs: normalizeStringList(parsed.inputs),
      outputs: normalizeStringList(parsed.outputs),
      useWhen: normalizeStringList(parsed.use_when),
      avoidWhen: normalizeStringList(parsed.avoid_when),
      notes: normalizeStringList(parsed.notes),
      sourceHeading: heading,
      sourcePath,
    };

    entries.push(entry);
  }

  if (entries.length === 0) {
    throw new Error('CAPABILITIES.md: no capability spec blocks were loaded');
  }

  const byLegacyId = new Map<string, CapabilityDefinition>();
  const byCanonicalId = new Map<string, CapabilityDefinition>();
  const byLookupKey = new Map<string, CapabilityDefinition>();

  for (const entry of entries) {
    registerUnique(byLegacyId, entry.legacyId, entry, 'legacy capability id');
    registerUnique(byCanonicalId, entry.canonicalId, entry, 'canonical capability id');
    registerUnique(byLookupKey, entry.legacyId, entry, 'capability lookup key');
    registerUnique(byLookupKey, entry.canonicalId, entry, 'capability lookup key');
    for (const alias of entry.aliases) {
      if (alias === entry.legacyId || alias === entry.canonicalId) {
        continue;
      }
      registerUnique(byLookupKey, alias, entry, 'capability lookup key');
    }
  }

  return { entries, byLegacyId, byCanonicalId, byLookupKey };
}

export function getCapabilityDefinition(
  registry: CapabilityRegistry,
  id: string,
): CapabilityDefinition | undefined {
  return registry.byLookupKey.get(id);
}
