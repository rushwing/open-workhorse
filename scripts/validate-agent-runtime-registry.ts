import { loadCapabilityRegistry } from '../src/agent-runtime/capabilities/registry.js';
import { loadConnectorRegistry } from '../src/agent-runtime/connectors/registry.js';

function main(): void {
  const capabilities = loadCapabilityRegistry(process.cwd());
  const connectors = loadConnectorRegistry(process.cwd(), capabilities);

  console.log(
    [
      `agent-runtime-registry: loaded ${capabilities.entries.length} capabilities`,
      `${connectors.entries.length} connectors`,
      `${capabilities.byCanonicalId.size} canonical capability ids`,
    ].join(' | '),
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`agent-runtime-registry: failed: ${message}`);
  process.exit(1);
}

