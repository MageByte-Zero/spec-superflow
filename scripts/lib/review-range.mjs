import { execFileSync } from 'node:child_process';
import { readIsolationContext } from './isolation-context.mjs';
import { readState } from './state-loader.mjs';

function git(changeDir, args) {
  return execFileSync('git', ['-C', changeDir, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
}

export function assertNonEmptyDiff(changeDir, base, head) {
  if (!git(changeDir, ['diff', '--name-only', base, head, '--'])) {
    throw new Error('Passing review must cover a non-empty Git diff');
  }
}

// The target comes from recorded provenance, never from a caller-supplied
// review base. The anchor is the commit the change started from: `workflow
// start` records it in the change state, and an isolation context records it
// when a protected trunk required one. Only a change with neither falls back to
// an unambiguous trunk merge-base, which is what older/manual branches use.
export function assertFinalReviewRange(changeDir, base, head) {
  const recorded = readState(changeDir).review_base ?? readIsolationContext(changeDir)?.review_base;
  let expected = recorded;
  if (expected === undefined || expected === null) {
    const target = resolveTargetBranch(changeDir);
    expected = git(changeDir, ['merge-base', `refs/heads/${target}`, head]);
  }
  if (!/^[0-9a-f]{40}$/i.test(expected)) throw new Error('Recorded final review base must be an immutable commit');
  git(changeDir, ['merge-base', '--is-ancestor', expected, head]);
  if (base !== expected) throw new Error('Final review must cover the complete target merge-base..HEAD range');
  if (head !== git(changeDir, ['rev-parse', 'HEAD'])) throw new Error('Final review must cover current HEAD');
}

// Trunk identity stays a branch name: one commit may live on several branches,
// so a SHA cannot answer "which branch is the trunk". The name is used only to
// derive a range here; merge targets keep the recorded branch plus the
// current-checkout verification in `ssf finish`.
function resolveTargetBranch(changeDir) {
  const recorded = readIsolationContext(changeDir)?.target_branch ?? readState(changeDir).target_branch;
  if (recorded) return recorded;
  const trunks = ['main', 'master'].filter(name => {
    try { git(changeDir, ['rev-parse', '--verify', `refs/heads/${name}`]); return true; }
    catch { return false; }
  });
  if (trunks.length !== 1) throw new Error(`Final review has no recorded start anchor; backfill it once with "ssf state set ${changeDir} review_base <start-commit>"`);
  return trunks[0];
}
