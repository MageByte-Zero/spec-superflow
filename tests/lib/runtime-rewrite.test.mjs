// tests/lib/runtime-rewrite.test.mjs
// Tests for scripts/lib/runtime-rewrite.mjs — shared portable-runtime rewriting.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadModule(relPath) {
  return import(pathToFileURL(join(process.cwd(), relPath)).href);
}

describe('runtime-rewrite', () => {
  it('rewrites a bare ssf debug invocation to the local runtime', async () => {
    const { rewriteRuntime } = await loadModule('scripts/lib/runtime-rewrite.mjs');
    const out = rewriteRuntime('Run `ssf debug attempt record <change-dir>`.', '/root/plugin');
    assert.doesNotMatch(out, /\bssf debug\b/);
    assert.match(out, /node ['"].+spec-superflow\.mjs['"] debug attempt record/);
  });

  it('rewrites npx and node scripts forms', async () => {
    const { rewriteRuntime } = await loadModule('scripts/lib/runtime-rewrite.mjs');
    const out = rewriteRuntime(
      '`npx --yes --package spec-superflow@0.12.1 ssf state init <dir>` and `node scripts/spec-superflow.mjs state get <dir>`',
      '/root/plugin',
    );
    assert.doesNotMatch(out, /npx --yes --package spec-superflow@\d+\.\d+\.\d+ ssf/);
    assert.doesNotMatch(out, /node scripts\/spec-superflow\.mjs/);
    assert.match(out, /node ['"].+spec-superflow\.mjs['"] state/);
  });
});
