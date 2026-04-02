import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSimpleYaml } from '../src/agent-runtime/shared/simple-yaml.js';

describe('parseSimpleYaml', () => {
  test('parses folded block scalars using >', () => {
    const parsed = parseSimpleYaml(`notes: >
  first line
  second line
`);

    assert.deepEqual(parsed, {
      notes: 'first line second line',
    });
  });

  test('throws on unsupported literal block scalars using |', () => {
    assert.throws(
      () =>
        parseSimpleYaml(`notes: |
  first line
  second line
`),
      /Unsupported literal block scalar/,
    );
  });
});
