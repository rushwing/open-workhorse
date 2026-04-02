import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSimpleYaml } from '../src/agent-runtime/shared/simple-yaml';

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

  test('parses block-list continuation lines into the preceding item', () => {
    const parsed = parseSimpleYaml(`notes:
  - first item
  - second item first line;
    second item second line
  - third item
`);

    assert.deepEqual(parsed, {
      notes: [
        'first item',
        'second item first line; second item second line',
        'third item',
      ],
    });
  });
});
