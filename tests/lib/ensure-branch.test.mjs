// tests/lib/ensure-branch.test.mjs
// Regression for #15: git branch isolation must be enforceable, not just advised.
// `ensure-branch.mjs` must refuse to proceed on a protected branch when it cannot
// isolate, and must allow work on a non-protected branch.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const ENSURE = join(ROOT, 'scripts', 'ensure-branch.mjs');

// Windows: deleting a directory that still holds git/submodule file handles
// can transiently fail with EPERM/EBUSY. Retry with a short delay so a pure
// cleanup race never fails the test; non-handle errors still propagate.
function rmRetry(dir) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (!['EPERM', 'EBUSY'].includes(e.code)) throw e;
      if (attempt === 4) throw e;
      // 阻塞当前线程 300ms（Atomics.wait 无 shell、无定时器泄漏），
      // 等待 Windows 释放 git/submodule 文件句柄后重试。
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }
}

// 无 shell 的进程调用（literal argv 数组）：ai-plugin-scanner 会将
// execSync + 模板字符串插值识别为 shell injection pattern（high），
// 且 spawnSync 数组形式本身也更安全。统一从这里发起子进程。
function runProcess(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 60000,
    env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file' },
    ...opts,
  });
  return r;
}

function run(args) {
  // args 由测试字面量拼接（路径可能含空格），拆分为 argv 数组传递。
  const argv = args.match(/"[^"]*"|\S+/g).map((a) => a.replace(/^"|"$/g, ''));
  const r = runProcess(process.execPath, [ENSURE, ...argv]);
  if (r.status === 0) return { ok: true, out: r.stdout || '' };
  return { ok: false, out: `${r.stdout || ''}\n${r.stderr || ''}` || r.stderr || String(r.error) };
}

function git(dir, ...args) {
  const r = runProcess('git', ['-c', 'user.email=t@t', '-c', 'user.name=test', ...args], { cwd: dir });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return (r.stdout || '').trim();
}

// Create a bare standalone git repo with a committed file at `dir`.
function makeRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '--initial-branch=main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
}

// Git for Windows resolves `file:///C:/...` to the POSIX-style path `/C:/...`,
// whose drive-letter conversion intermittently fails under heavy filesystem
// load (`git clone` reports "does not appear to be a git repository" even
// though the source repo is readable). The plain absolute path `C:/...` is
// handled natively and deterministically, so submodule URLs use it on Windows;
// POSIX keeps the file:// form (the reliable cross-platform shape CI depends
// on). Under load the file:// form failed 100% of probe clones while the plain
// path succeeded 100%, so this is the root-cause fix, not a retry band-aid.
function submoduleSourceUrl(dir) {
  return process.platform === 'win32' ? dir.replace(/\\/g, '/') : pathToFileURL(dir).href;
}

// Build a local-only submodule fixture (no network):
//   main  --submodule--> subA  --submodule--> subB
// All URLs point at local repos, so CI without internet works.
function makeSubmoduleFixture(base) {
  const subB = join(base, 'subB');
  const subA = join(base, 'subA');
  const main = join(base, 'main');

  mkdirSync(subB, { recursive: true });
  writeFileSync(join(subB, 'b.txt'), 'b');
  makeRepo(subB);

  mkdirSync(subA, { recursive: true });
  writeFileSync(join(subA, 'a.txt'), 'a');
  makeRepo(subA);
  git(subA, 'submodule', 'add', submoduleSourceUrl(subB), 'subB');
  git(subA, 'commit', '-q', '-m', 'add nested submodule subB');

  mkdirSync(main, { recursive: true });
  writeFileSync(join(main, 'm.txt'), 'm');
  makeRepo(main);
  git(main, 'submodule', 'add', submoduleSourceUrl(subA), 'subA');
  git(main, 'commit', '-q', '-m', 'add submodule subA');
  return { main, subA, subB };
}

// One rebuild retry: Windows AV/file-system hiccups can transiently hide a
// freshly created local repo from a file:// clone under full-suite concurrency.
// The fixture is pure test infrastructure, so a single clean rebuild is enough
// to ride the hiccup out; a second failure is a real problem and propagates.
function makeSubmoduleFixtureSafe(base) {
  try {
    return makeSubmoduleFixture(base);
  } catch (e) {
    rmRetry(base);
    mkdirSync(base, { recursive: true });
    return makeSubmoduleFixture(base);
  }
}

// Register a submodule whose URL points at a nonexistent local repo, without
// invoking `git submodule add` (which would reject the URL up front). The
// gitlink target is the superproject's own HEAD, which is fine: the test only
// cares that recursive init fails to clone.
function addBogusSubmodule(repoDir, name, url) {
  const modulesPath = join(repoDir, '.gitmodules');
  const existing = existsSync(modulesPath) ? readFileSync(modulesPath, 'utf8') : '';
  writeFileSync(modulesPath, `${existing}\n[submodule "${name}"]\n\tpath = ${name}\n\turl = ${url}\n`);
  const head = git(repoDir, 'rev-parse', 'HEAD');
  git(repoDir, 'update-index', '--add', '--cacheinfo', `160000,${head},${name}`);
  git(repoDir, 'add', '.gitmodules');
  git(repoDir, 'commit', '-q', '-m', 'add bogus submodule');
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
    if (existsSync(plainDir)) rmRetry(plainDir);
    if (existsSync(repoDir)) rmRetry(repoDir);
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

  it('SHALL default the isolation branch name to the change directory name when no change-name is given', () => {
    const changeDir = join(repoDir, 'changes', 'default-name');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'proposal.md'), 'Uncommitted planning artifact.');
    git(repoDir, 'checkout', '-q', 'main');

    const r = run(`"${changeDir}"`);
    const worktree = join(dirname(repoDir), `${basename(repoDir)}-default-name`);

    try {
      assert.equal(r.ok, true, r.out);
      assert.match(r.out, /created git worktree .* on branch 'default-name'/i);
      const branch = git(worktree, 'branch', '--show-current');
      assert.equal(branch, 'default-name', 'default isolation branch must be named after the change directory');
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

describe('worktree-lifecycle R1/R2: submodule init + progress cwd warning', () => {
  it('R1 SHALL init submodules (incl. nested) inside the created worktree', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-ensure-sub-'));
    try {
      const { main } = makeSubmoduleFixtureSafe(base);
      const changeDir = join(main, 'changes', 'sm-change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'proposal.md'), 'x');

      const r = run(`"${changeDir}" sm-change`);
      const worktree = join(base, 'main-sm-change');

      assert.equal(r.ok, true, r.out);
      assert.equal(existsSync(join(worktree, 'subA', 'a.txt')), true, 'outer submodule content must be ready');
      assert.equal(existsSync(join(worktree, 'subA', 'subB', 'b.txt')), true, 'nested submodule content must be ready');
      // R2: progress ledger is created even when its directory did not exist.
      assert.equal(existsSync(join(changeDir, '.superpowers', 'sdd', 'progress.md')), true, 'progress.md must be created');
    } finally {
      rmRetry(base);
    }
  });

  it('R1 SHALL exit non-zero with the failure reason when submodule init fails', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-ensure-badsub-'));
    try {
      const { main } = makeSubmoduleFixtureSafe(base);
      addBogusSubmodule(main, 'subX', pathToFileURL(join(base, 'does-not-exist')).href);
      const changeDir = join(main, 'changes', 'bad-change');
      mkdirSync(changeDir, { recursive: true });

      const r = run(`"${changeDir}" bad-change`);

      assert.equal(r.ok, false, `expected non-zero exit, got: ${r.out}`);
      assert.match(r.out, /submodule initialization failed/i);
    } finally {
      rmRetry(base);
    }
  });

  it('R1 SHALL skip submodule init and still succeed when there is no .gitmodules', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-ensure-nosub-'));
    try {
      const main = join(base, 'main');
      mkdirSync(main, { recursive: true });
      writeFileSync(join(main, 'README.md'), 'x');
      makeRepo(main);
      const changeDir = join(main, 'changes', 'plain-change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'proposal.md'), 'x');

      const r = run(`"${changeDir}" plain-change`);
      const worktree = join(base, 'main-plain-change');

      assert.equal(r.ok, true, r.out);
      assert.equal(existsSync(join(worktree, 'README.md')), true);
      assert.equal(existsSync(join(worktree, '.gitmodules')), false);
    } finally {
      rmRetry(base);
    }
  });

  it('R2 SHALL append the cwd warning to progress.md without overwriting existing records', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-ensure-prog-'));
    try {
      const main = join(base, 'main');
      mkdirSync(main, { recursive: true });
      writeFileSync(join(main, 'README.md'), 'x');
      makeRepo(main);
      const changeDir = join(main, 'changes', 'pg-change');
      mkdirSync(join(changeDir, '.superpowers', 'sdd'), { recursive: true });
      writeFileSync(join(changeDir, '.superpowers', 'sdd', 'progress.md'), 'EXISTING RECORD\n');

      const r = run(`"${changeDir}" pg-change`);
      // ensure-branch 写入 progress 的隔离路径来自 `git rev-parse
      // --show-toplevel`（长路径形式）；CI Windows 的 TEMP 是 8.3 短名，
      // 断言必须用 native realpath 规范化后的形式比较。
      const worktree = realpathSync.native(join(base, 'main-pg-change'));

      assert.equal(r.ok, true, r.out);
      const progress = readFileSync(join(changeDir, '.superpowers', 'sdd', 'progress.md'), 'utf8');
      assert.match(progress, /EXISTING RECORD/);
      assert.ok(progress.indexOf('EXISTING RECORD') < progress.indexOf('cwd 警告'), 'existing record preserved, warning appended');
      assert.match(progress, /cwd 警告/);
      assert.ok(progress.includes(worktree), `warning must mention isolated context path ${worktree}`);
      assert.match(progress, /Bash cwd 不持续/);
      assert.match(progress, /cd /);
    } finally {
      rmRetry(base);
    }
  });

  it('R1/R2 SHALL init submodules and write the warning on the git switch -c fallback path', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-ensure-fb-'));
    try {
      const { main } = makeSubmoduleFixtureSafe(base);
      const changeDir = join(main, 'changes', 'fb-change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'proposal.md'), 'x');
      // Occupy the worktree path so `git worktree add` fails and the fallback
      // `git switch -c` path runs instead.
      const blockedPath = join(base, 'main-fb-change');
      mkdirSync(blockedPath, { recursive: true });
      writeFileSync(join(blockedPath, 'blocker.txt'), 'x');

      const r = run(`"${changeDir}" fb-change`);

      assert.equal(r.ok, true, r.out);
      assert.equal(existsSync(join(main, 'subA', 'a.txt')), true, 'fallback outer submodule content');
      assert.equal(existsSync(join(main, 'subA', 'subB', 'b.txt')), true, 'fallback nested submodule content');
      const progress = readFileSync(join(changeDir, '.superpowers', 'sdd', 'progress.md'), 'utf8');
      // repoRoot 来自 `git rev-parse --show-toplevel`（长路径形式），CI
      // Windows 的 TEMP 是 8.3 短名，断言必须用 native realpath 规范化。
      assert.ok(progress.includes(realpathSync.native(main)), 'warning must mention the isolated (branch) context path');
    } finally {
      rmRetry(base);
    }
  });
});
