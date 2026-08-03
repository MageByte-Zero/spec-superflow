// tests/lib/ensure-branch.test.mjs
// Regression for #15: git branch isolation must be enforceable, not just advised.
// `ensure-branch.mjs` must refuse to proceed on a protected branch when it cannot
// isolate, and must allow work on a non-protected branch.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const ENSURE = join(ROOT, 'scripts', 'ensure-branch.mjs');

function run(args) {
  try {
    const out = execSync(`node ${ENSURE} ${args}`, { encoding: 'utf-8', stdio: 'pipe', timeout: 10000 });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}\n${e.stderr || ''}` || e.message };
  }
}

function git(dir, ...args) {
  execSync(`git -c user.email=t@t -c user.name=test ${args.join(' ')}`, { cwd: dir, stdio: 'pipe', timeout: 10000 });
}

describe('BUG/#15: ensure-branch enforces isolation', () => {
  let plainDir, repoDir;
  before(() => {
    plainDir = mkdtempSync(join(tmpdir(), 'ssf-ensure-plain-'));
    repoDir = mkdtempSync(join(tmpdir(), 'ssf-ensure-repo-'));
    mkdirSync(join(repoDir, 'specs'), { recursive: true });
    writeFileSync(join(repoDir, 'README.md'), 'x');
    // The fixture checks out the protected `main` branch below. Pin it here
    // instead of inheriting Git's host-specific init.defaultBranch (CI may
    // otherwise create `master`).
    git(repoDir, 'init', '-q', '--initial-branch=main');
    git(repoDir, 'add', '-A');
    git(repoDir, 'commit', '-q', '-m', 'init');
    git(repoDir, 'checkout', '-q', '-b', 'feature/work');
  });
  after(() => {
    if (existsSync(plainDir)) rmSync(plainDir, { recursive: true, force: true });
    if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
  });

  it('SHALL refuse (non-zero) when not inside a git repository', () => {
    const r = run(`"${plainDir}"`);
    assert.equal(r.ok, false, 'ensure-branch must fail outside a git repo');
  });

  it('SHALL allow (zero) work on a non-protected branch', () => {
    const r = run(`"${repoDir}"`);
    assert.equal(r.ok, true, `ensure-branch should pass on feature branch, got: ${r.out}`);
    assert.match(r.out, /already isolated/i);
  });

  it('SHALL create a sibling worktree and carry only the active change artifacts from main', () => {
    const changeDir = join(repoDir, 'changes', 'planned-change');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'proposal.md'), 'Uncommitted planning artifact.');
    git(repoDir, 'checkout', '-q', 'main');

    const r = run(`"${changeDir}" planned-change`);
    const worktree = join(dirname(repoDir), `${basename(repoDir)}-planned-change`);

    try {
      assert.equal(r.ok, true, r.out);
      assert.equal(existsSync(join(worktree, 'changes', 'planned-change', 'proposal.md')), true);
      assert.equal(existsSync(join(worktree, 'changes', 'planned-change', 'README.md')), false);
    } finally {
      if (existsSync(worktree)) git(repoDir, 'worktree', 'remove', '--force', worktree);
    }
  });

  it('SHALL reject a change name that is not one safe path segment', () => {
    const changeDir = join(repoDir, 'changes', 'safe-change');
    mkdirSync(changeDir, { recursive: true });
    git(repoDir, 'checkout', '-q', 'main');

    const r = run(`"${changeDir}" ../../outside`);

    assert.equal(r.ok, false, r.out);
    assert.match(r.out, /single safe path segment/i);
  });
});
