// scripts/run-tests.mjs
// Cross-platform test runner entry point.
//
// package.json's `test` script historically relied on a shell glob
// (`node --test ... tests/lib/*.test.mjs`). Windows cmd/PowerShell do not
// expand globs and Node 20's `--test` does not glob either, so that form
// fails on Windows + Node 20. This script enumerates the test files itself
// with node:fs and passes an explicit file list to `node --test`, which works
// identically on every platform and every supported Node version.
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const e2e = join(root, 'tests', 'e2e.test.mjs');
const libDir = join(root, 'tests', 'lib');

const files = [];
if (existsSync(e2e)) files.push(e2e);

if (existsSync(libDir)) {
  for (const name of readdirSync(libDir).sort()) {
    if (name.endsWith('.test.mjs')) {
      files.push(join(libDir, name));
    }
  }
}

if (files.length === 0) {
  console.error('run-tests: no test files found under tests/');
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=2', ...files],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(`run-tests: failed to spawn test runner: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
