import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const runner = readFileSync(join(ROOT, 'scripts', 'run-tests.mjs'), 'utf8');

describe('Node 20 test entry', () => {
  it('delegates to a cross-platform runner that enumerates the full ESM set', () => {
    // The runner replaces the shell glob (tests/lib/*.test.mjs), which Windows
    // cmd/PowerShell and Node 20 --test do not expand.
    assert.match(pkg.scripts.test, /node scripts\/run-tests\.mjs/);
    assert.match(runner, /'e2e\.test\.mjs'/);
    assert.match(runner, /'lib'/);
    assert.match(runner, /endsWith\('\.test\.mjs'\)/);
    assert.match(runner, /--test-concurrency=2/);
    assert.doesNotMatch(runner, /experimental-strip-types/);
    assert.equal(existsSync(join(ROOT, 'tests', 'e2e.test.mjs')), true);
    assert.equal(existsSync(join(ROOT, 'tests', 'e2e.test.ts')), false);
  });
});
