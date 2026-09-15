// ssf runtime — portable, root-independent operations used by canonical skills.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const ASSETS = new Set([
  'docs/artifact-contract.md',
  'docs/decision-points.md',
  'docs/state-machine.md',
  'skills/build-executor/implementer-prompt.md',
  'skills/build-executor/task-reviewer-prompt.md',
  'templates/design.md',
  'templates/execution-contract.md',
  'templates/proposal.md',
  'templates/spec.md',
  'templates/tasks.md',
]);

export async function run(args) {
  const [operation, ...rest] = args;

  switch (operation) {
    case 'check-update':
      return runScript('scripts/check-update.mjs', rest);
    case 'infer':
      return runScript('scripts/infer-workflow.mjs', rest);
    case 'guard':
      return runScript('scripts/guard/guard.mjs', rest);
    case 'config':
      return runReadOnlyConfig(rest);
    case 'asset':
      return readAsset(rest);
    default:
      return usage(`Unknown runtime operation: ${operation || '(missing)'}`);
  }
}

function runScript(relativeScript, args) {
  const result = spawnSync(process.execPath, [join(ROOT, relativeScript), ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

async function runReadOnlyConfig(args) {
  if (args.includes('--set')) {
    return usage('runtime config is read-only; use the main ssf config command to change configuration');
  }
  const { run: runConfig } = await import('./cmd-config.mjs');
  await runConfig(args);
}

function readAsset(args) {
  if (args[0] !== 'read' || args.length !== 2) {
    return usage('Usage: ssf runtime asset read <allowed-relative-path>');
  }

  const assetPath = args[1];
  if (!ASSETS.has(assetPath)) {
    return usage(`Asset is not in the runtime allowlist: ${assetPath}`);
  }

  process.stdout.write(readFileSync(join(ROOT, assetPath), 'utf8'));
}

function usage(message) {
  console.error(message);
  console.error(`Usage:
  ssf runtime check-update
  ssf runtime infer <change-dir>
  ssf runtime guard check <change-dir> <from-state> <to-state> [--workflow <mode>] [--json]
  ssf runtime config [--get <path>|--resolve-model <profile>]
  ssf runtime asset read <allowed-relative-path>`);
  process.exitCode = 2;
}

export { ASSETS };
