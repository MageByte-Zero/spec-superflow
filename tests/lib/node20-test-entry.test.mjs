import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

describe('Node 20 test entry', () => {
  it('runs the complete ESM test set with controlled Node concurrency', () => {
    assert.match(pkg.scripts.test, /tests\/e2e\.test\.mjs/);
    assert.match(pkg.scripts.test, /tests\/lib\/\*\.test\.mjs/);
    assert.match(pkg.scripts.test, /--test-concurrency=2/);
    assert.doesNotMatch(pkg.scripts.test, /experimental-strip-types/);
    assert.equal(existsSync(join(ROOT, 'tests', 'e2e.test.mjs')), true);
    assert.equal(existsSync(join(ROOT, 'tests', 'e2e.test.ts')), false);
  });
});
