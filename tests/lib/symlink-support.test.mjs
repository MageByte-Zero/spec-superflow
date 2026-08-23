// tests/lib/symlink-support.test.mjs
// Tests for tests/helpers/symlink-support.mjs — the cross-platform symlink
// capability probe used to skip symlink fixtures on hosts that cannot create
// them (Windows without Developer Mode / admin privileges throw EPERM).
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Windows-safe dynamic import: bare Windows paths (D:\...) are not valid ESM
// import specifiers, so convert to a file:// URL. No-op on POSIX.
async function loadModule(relPath) {
  return import(pathToFileURL(join(process.cwd(), relPath)).href);
}

describe('symlink-support helper', () => {
  let canCreateSymlink;

  before(async () => {
    ({ canCreateSymlink } = await loadModule('tests/helpers/symlink-support.mjs'));
  });

  it('reports true when the probe can create symlinks', () => {
    assert.equal(canCreateSymlink(() => true), true);
  });

  it('reports false when the probe cannot create symlinks', () => {
    assert.equal(canCreateSymlink(() => false), false);
  });

  it('default probe returns a boolean for the real host', () => {
    assert.equal(typeof canCreateSymlink(), 'boolean');
  });
});
