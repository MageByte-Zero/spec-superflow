// scripts/lib/cmd-isolate.mjs — `ssf isolate` CLI wrapper around ensure-branch.mjs
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENSURE = join(__dirname, '..', 'ensure-branch.mjs');

export async function run(args) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { force: { type: 'boolean', default: false } },
  });
  const changeDir = positionals[0];
  const changeName = positionals[1];
  if (!changeDir) {
    console.error('Usage: ssf isolate <change-dir> [change-name] [--force]');
    process.exit(2);
  }
  const extra = values.force ? ['--force'] : [];
  // Literal command ('node') + literal argument array, no shell — same safe form
  // as cmd-install-*.mjs. execFileSync throws on non-zero exit; propagate its status.
  const nodeArgs = [ENSURE, changeDir];
  if (changeName !== undefined) nodeArgs.push(changeName);
  for (const a of extra) nodeArgs.push(a);
  try {
    execFileSync('node', nodeArgs, {
      stdio: 'inherit',
      timeout: 150000,
    });
    process.exit(0);
  } catch (e) {
    process.exit(e.status ?? 1);
  }
}
