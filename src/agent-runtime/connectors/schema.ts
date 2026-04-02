import type { CapabilityDefinition, CapabilitySideEffect } from '../capabilities/schema.js';

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

