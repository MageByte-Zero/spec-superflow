import { execFileSync } from 'node:child_process';
import { readIsolationContext } from './isolation-context.mjs';

function git(changeDir, args) {
  return execFileSync('git', ['-C', changeDir, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
}

export function assertNonEmptyDiff(changeDir, base, head) {
  if (!git(changeDir, ['diff', '--name-only', base, head, '--'])) {
    throw new Error('Passing review must cover a non-empty Git diff');
  }
}

// The target comes from isolation provenance, never from a caller-supplied
// review base. Older/manual branches may use an unambiguous trunk.
export function assertFinalReviewRange(changeDir, base, head) {
  const context = readIsolationContext(changeDir);
  let target = context?.target_branch;
  if (!target) {
    const trunks = ['main', 'master'].filter(name => {
      try { git(changeDir, ['rev-parse', '--verify', `refs/heads/${name}`]); return true; }
      catch { return false; }
    });
    if (trunks.length !== 1) throw new Error('Final review requires an unambiguous recorded target branch');
    [target] = trunks;
  }
  const expected = context?.review_base ?? git(changeDir, ['merge-base', `refs/heads/${target}`, head]);
  if (!/^[0-9a-f]{40}$/i.test(expected)) throw new Error('Recorded final review base must be an immutable commit');
  git(changeDir, ['merge-base', '--is-ancestor', expected, head]);
  if (base !== expected) throw new Error('Final review must cover the complete target merge-base..HEAD range');
  if (head !== git(changeDir, ['rev-parse', 'HEAD'])) throw new Error('Final review must cover current HEAD');
}
