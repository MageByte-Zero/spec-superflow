import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runGit(directory, args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}

/**
 * Create one seeded Git repository for a test suite and independent copies for
 * its cases. Callers populate the initial worktree; this fixture supplies the
 * local Git identity and stable two-commit history shared by every copy.
 */
export function createGitSeedFixture({
  setup = () => {},
  initialCommitMessage = 'initial test fixture',
  secondCommit = {
    path: 'git-range-marker.txt',
    content: 'second commit\n',
    message: 'second test fixture commit',
  },
  config = {},
  prefix = 'ssf-git-seed-',
  copyPrefix = 'ssf-git-copy-',
} = {}) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const seed = join(root, 'seed');
  const copies = new Set();
  mkdirSync(seed);

  setup(seed);
  runGit(seed, ['init', '--quiet']);
  runGit(seed, ['config', 'user.name', config.name ?? 'Spec Superflow Test']);
  runGit(seed, ['config', 'user.email', config.email ?? 'tests@example.invalid']);
  for (const [key, value] of Object.entries(config.values ?? {})) {
    runGit(seed, ['config', '--local', key, value]);
  }
  runGit(seed, ['add', '--all']);
  runGit(seed, ['commit', '--quiet', '--message', initialCommitMessage]);
  const base = runGit(seed, ['rev-parse', 'HEAD']);

  writeFileSync(join(seed, secondCommit.path), secondCommit.content);
  runGit(seed, ['add', '--all']);
  runGit(seed, ['commit', '--quiet', '--message', secondCommit.message]);
  const head = runGit(seed, ['rev-parse', 'HEAD']);

  return {
    seed,
    base,
    head,
    createCopy() {
      const copy = mkdtempSync(join(tmpdir(), copyPrefix));
      cpSync(seed, copy, {
        recursive: true,
        dereference: false,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      });
      copies.add(copy);
      return copy;
    },
    dispose() {
      for (const copy of copies) rmSync(copy, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    },
  };
}
