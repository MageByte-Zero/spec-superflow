// Raw-package smoke: canonical skills must work without host plugin-root variables
// or a globally installed `ssf` binary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();

function run(command, args, options) {
  // On Windows, npm/npx are .cmd shims that spawnSync cannot exec without a shell.
  const result = spawnSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32', ...options });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stderr}`);
  return result.stdout;
}

describe('raw-package runtime smoke', () => {
  it('runs a packed canonical runtime with no plugin-root variables or global ssf', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['test:raw-mode'], 'node --test tests/lib/raw-mode-smoke.test.mjs');

    const tempRoot = mkdtempSync(join(tmpdir(), 'ssf-raw-mode-'));
    try {
      const packJson = run('npm', ['pack', '--json', '--pack-destination', tempRoot], { cwd: ROOT });
      const [{ filename }] = JSON.parse(packJson);
      const env = { ...process.env };
      delete env.CLAUDE_PLUGIN_ROOT;
      delete env.PLUGIN_ROOT;
      delete env.CODEX_HOME;

      const output = run('npx', [
        '--yes', '--package', join(tempRoot, filename), 'ssf',
        'runtime', 'asset', 'read', 'docs/state-machine.md',
      ], { cwd: tempRoot, env });

      assert.match(output, /State Machine/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
