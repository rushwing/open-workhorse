export type CapabilitySideEffect = 'none' | 'local_write' | 'remote_write';

export interface CapabilityDefinition {
  legacyId: string;
  canonicalId: string;
  aliases: string[];
  legacyFamily: string;
  canonicalFamily: string;
  defaultEnabled: boolean;
  sideEffect: CapabilitySideEffect;
  inputs: string[];
  outputs: string[];
  useWhen: string[];
  avoidWhen: string[];
  notes: string[];
  sourceHeading: string;
  sourcePath: string;
}

const LEGACY_CAPABILITY_PATTERN = /^[a-z]+-[a-z]+-[a-z_]+$/;
const LEGACY_FAMILY_PATTERN = /^[a-z]+-\*$/;
const SIDE_EFFECTS = new Set<CapabilitySideEffect>(['none', 'local_write', 'remote_write']);

export function capabilityIdToCanonicalId(legacyId: string): string {
  if (!LEGACY_CAPABILITY_PATTERN.test(legacyId)) {
    throw new Error(`Invalid legacy capability id: ${legacyId}`);
  }
  const [domain, resource, action] = legacyId.split('-');
  return `${domain}.${resource}.${action}`;
}

export function capabilityFamilyToCanonicalFamily(legacyFamily: string): string {
  if (!LEGACY_FAMILY_PATTERN.test(legacyFamily)) {
    throw new Error(`Invalid legacy capability family: ${legacyFamily}`);
  }
  return `${legacyFamily.slice(0, -2)}.*`;
}

export interface RawCapabilityDefinition {
  capability: unknown;
  family: unknown;
  default_enabled: unknown;
  side_effect: unknown;
  aliases?: unknown;
  inputs?: unknown;
  outputs?: unknown;
  use_when?: unknown;
  avoid_when?: unknown;
  notes?: unknown;
}

export function assertCapabilitySideEffect(value: unknown, context: string): CapabilitySideEffect {
  if (typeof value !== 'string' || !SIDE_EFFECTS.has(value as CapabilitySideEffect)) {
    throw new Error(`${context}: invalid side_effect "${String(value)}"`);
  }
  return value as CapabilitySideEffect;
}

export function assertLegacyCapabilityId(value: unknown, context: string): string {
  if (typeof value !== 'string' || !LEGACY_CAPABILITY_PATTERN.test(value)) {
    throw new Error(`${context}: invalid capability "${String(value)}"`);
  }
  return value;
}

export function assertLegacyCapabilityFamily(value: unknown, context: string): string {
  if (typeof value !== 'string' || !LEGACY_FAMILY_PATTERN.test(value)) {
    throw new Error(`${context}: invalid family "${String(value)}"`);
  }
  return value;
}
