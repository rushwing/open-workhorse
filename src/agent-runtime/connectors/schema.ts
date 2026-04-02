import type { CapabilityDefinition, CapabilitySideEffect } from '../capabilities/schema';

export interface ConnectorDefinition {
  bindingId: string;
  capabilityLegacyId: string;
  capabilityCanonicalId: string;
  capability: CapabilityDefinition;
  backend: string;
  driver: string;
  entrypoint: string;
  requires: string[];
  returns: string[];
  sideEffect: CapabilitySideEffect;
  approvalMode: string;
  notes: string[];
  sourceHeading: string;
  sourcePath: string;
}

export interface RawConnectorDefinition {
  capability: unknown;
  backend: unknown;
  driver: unknown;
  entrypoint: unknown;
  requires?: unknown;
  returns?: unknown;
  side_effect: unknown;
  approval_mode: unknown;
  notes?: unknown;
}

const BACKEND_PATTERN = /^[a-z][a-z0-9_-]*$/;

export function assertConnectorBackend(value: unknown, context: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${context}: backend must be a string`);
  }

  const backend = value.trim();
  if (backend === '') {
    throw new Error(`${context}: backend must be a non-empty string`);
  }
  if (!BACKEND_PATTERN.test(backend)) {
    throw new Error(`${context}: invalid backend "${backend}"`);
  }

  return backend;
}
