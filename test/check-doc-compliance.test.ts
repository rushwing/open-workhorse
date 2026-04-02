import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SOURCE_SCRIPT = join(process.cwd(), 'scripts', 'check-doc-compliance.sh');

describe('check-doc-compliance.sh', () => {
  async function createFixtureRepo(): Promise<string> {
    const repoRoot = await mkdtemp(join(tmpdir(), 'doc-compliance-'));
    await mkdir(join(repoRoot, 'scripts'), { recursive: true });
    await mkdir(join(repoRoot, 'docs'), { recursive: true });

    const scriptPath = join(repoRoot, 'scripts', 'check-doc-compliance.sh');
    await writeFile(
      scriptPath,
      await readFile(SOURCE_SCRIPT, 'utf8'),
      'utf8',
    );

    spawnSync('git', ['init'], { cwd: repoRoot, encoding: 'utf8' });
    return repoRoot;
  }

  test('passes when tracked docs are clean', async () => {
    const repoRoot = await createFixtureRepo();
    await writeFile(join(repoRoot, 'docs', 'clean.md'), '# Clean doc\nNo forbidden wording.\n', 'utf8');
    spawnSync('git', ['add', 'docs/clean.md', 'scripts/check-doc-compliance.sh'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    const result = spawnSync('bash', ['scripts/check-doc-compliance.sh'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, /doc-compliance: passed/);
    await rm(repoRoot, { recursive: true, force: true });
  });

  test('fails when tracked docs contain forbidden wording', async () => {
    const repoRoot = await createFixtureRepo();
    await writeFile(
      join(repoRoot, 'docs', 'bad.md'),
      '# Bad doc\nThis references fake-claude-code.\n',
      'utf8',
    );
    spawnSync('git', ['add', 'docs/bad.md'], { cwd: repoRoot, encoding: 'utf8' });

    const result = spawnSync('bash', ['scripts/check-doc-compliance.sh'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1, `expected exit 1, got ${result.status}`);
    assert.match(`${result.stdout}${result.stderr}`, /disallowed product-reference wording/);
    await rm(repoRoot, { recursive: true, force: true });
  });

  test('fails when grep itself errors instead of silently passing', async () => {
    const repoRoot = await createFixtureRepo();
    await writeFile(join(repoRoot, 'docs', 'clean.md'), '# Clean doc\nNo forbidden wording.\n', 'utf8');
    spawnSync('git', ['add', 'docs/clean.md', 'scripts/check-doc-compliance.sh'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    const fakeBin = join(repoRoot, 'fake-bin');
    await mkdir(fakeBin, { recursive: true });
    await writeFile(
      join(fakeBin, 'grep'),
      '#!/usr/bin/env bash\nexit 2\n',
      { encoding: 'utf8', mode: 0o755 },
    );

    const result = spawnSync('bash', ['scripts/check-doc-compliance.sh'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
    });

    assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
    assert.match(`${result.stdout}${result.stderr}`, /doc-compliance: error: grep failed/);
    await rm(repoRoot, { recursive: true, force: true });
  });
});
