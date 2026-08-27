// tests/lib/cmd-finish.test.mjs
// `ssf finish <change-dir>` — merge 隔离分支回主干（--no-ff）、验证同步、
// 清理 worktree 与隔离分支、错误路径（未提交改动 / merge 冲突 / 无隔离上下文）
// 以及 cwd 越界 WARN。全部通过真实 git 操作 + 真实 CLI 进程完成。
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CLI = join(ROOT, 'scripts', 'spec-superflow.mjs');
const ENSURE = join(ROOT, 'scripts', 'ensure-branch.mjs');

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

// 全部 git 调用走无 shell 的 spawnSync；注入 GIT_ALLOW_PROTOCOL=file 与
// -c user.name/email，避免依赖宿主 git 全局配置。
function git(dir, ...args) {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=test', '-C', dir, ...args], {
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file' },
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return (r.stdout || '').trim();
}

// pkg 覆盖 package.json 内容；pkg: null 表示不写 package.json（此时默认 npm test 必失败）。
// 默认 fixture 提供退出 0 的 test script，使默认验证路径真实可跑且通过。
function makeRepo(dir, { pkg = { name: 'main', version: '0.0.0', scripts: { test: 'node -e "process.exit(0)"' } } } = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), 'x');
  // finish 的主干验证默认执行 `npm test`（cwd=主仓库根）。
  if (pkg) writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  // 与真实仓库一致：changes/ 是 planning 产物，gitignore 忽略。缺少它时
  // ensure-branch 复制的 change 目录会（a）污染 worktree 的 status 干净检查、
  // （b）被 git add -A 提交进隔离分支后与主仓库未跟踪文件在 merge 时冲突。
  writeFileSync(join(dir, '.gitignore'), '/changes\n');
  git(dir, 'init', '-q', '--initial-branch=main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
}

// 主仓库 + changes/<name> 目录 + ensure-branch 创建隔离 worktree。
// 返回 { main, changeDir, worktree }；worktree = <base>/<mainBasename>-<name>。
// repoOpts 透传给 makeRepo（如 { pkg: null } 让默认 npm test 必然失败）。
function createIsolatedWorktree(base, name, repoOpts) {
  const main = join(base, 'main');
  makeRepo(main, repoOpts);
  const changeDir = join(main, 'changes', name);
  mkdirSync(changeDir, { recursive: true });
  const r = spawnSync(process.execPath, [ENSURE, changeDir, name], {
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file' },
  });
  assert.equal(r.status, 0, `ensure-branch failed: ${r.stdout}\n${r.stderr}`);
  const worktree = join(base, `${basename(main)}-${name}`);
  assert.equal(existsSync(worktree), true, `worktree must exist at ${worktree}`);
  return { main, changeDir, worktree };
}

// 在 worktree 写文件并提交，使 worktree 工作树干净。
function commitFileInWorktree(worktree, rel, content) {
  const p = join(worktree, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-q', '-m', `add ${rel}`);
}

function runFinish(changeDir, cwd, extraArgs = []) {
  const r = spawnSync(process.execPath, [CLI, 'finish', changeDir, ...extraArgs], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
  });
  return {
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    all: `${r.stdout || ''}\n${r.stderr || ''}`,
  };
}

describe('ssf finish — 一键收尾（worktree-lifecycle R3/R5）', () => {
  it('标准收尾：merge --no-ff 提交存在、worktree/分支删除、退出 0（cwd=主仓库时含 cwd WARN 但不阻断）', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-ok-'));
    tempDirs.push(base);
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-ok');
    commitFileInWorktree(worktree, 'feature.txt', 'branch work');
    const isoHead = git(main, 'rev-parse', 'finish-ok');

    const r = runFinish(changeDir, main);

    assert.equal(r.status, 0, r.all);
    // cwd=主仓库不在 worktree 内 → 输出一行含 worktree 绝对路径的 WARN，但不阻断
    assert.match(r.all, /WARN/);
    assert.ok(r.all.includes(resolve(worktree)), `WARN must contain worktree path ${resolve(worktree)}`);
    assert.match(r.all, /worktree 内路径/);
    // merge --no-ff 提交存在
    const mergeCommit = git(main, 'log', '--merges', '-1', '--format=%H');
    assert.ok(mergeCommit, 'must create a merge commit');
    assert.ok(r.stdout.includes(mergeCommit), 'report must print the merge commit');
    // 主干已包含隔离分支全部提交（隔离分支 head 是主干 head 的祖先）
    const mainHead = git(main, 'rev-parse', 'HEAD');
    assert.equal(git(main, 'merge-base', '--is-ancestor', isoHead, mainHead), '');
    // worktree 与隔离分支已清理
    assert.equal(existsSync(worktree), false, 'worktree must be removed');
    assert.equal(git(main, 'branch', '--list', 'finish-ok'), '', 'isolated branch must be deleted');
  });

  it('在 worktree 内运行：不输出 cwd WARN，仍正常收尾', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-inside-'));
    tempDirs.push(base);
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-inside');
    commitFileInWorktree(worktree, 'feature.txt', 'branch work');

    const r = runFinish(changeDir, worktree);

    assert.equal(r.status, 0, r.all);
    assert.doesNotMatch(r.all, /WARN/);
    assert.equal(existsSync(worktree), false, 'worktree must be removed');
  });

  it('worktree 有未提交改动：非零退出、列出未提交路径、不 merge、不删 worktree/分支', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-dirty-'));
    tempDirs.push(base);
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-dirty');
    writeFileSync(join(worktree, 'uncommitted.txt'), 'wip');

    const r = runFinish(changeDir, main);

    assert.notEqual(r.status, 0, r.all);
    assert.match(r.all, /uncommitted\.txt/);
    assert.equal(existsSync(worktree), true, 'worktree must survive');
    // 分支被 worktree 检出时 `git branch --list` 输出 `+ <name>` 前缀，仅断言存在
    assert.notEqual(git(main, 'branch', '--list', 'finish-dirty'), '', 'branch must survive');
    assert.equal(git(main, 'log', '--merges', '-1', '--format=%H'), '', 'no merge commit may be created');
  });

  it('merge 冲突：非零退出、提示手动解决、不删 worktree/分支、无 merge commit', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-conflict-'));
    tempDirs.push(base);
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-conflict');
    // 双方都修改同一文件：worktree 先提交，主干再提交 → merge 必然冲突
    commitFileInWorktree(worktree, 'shared.txt', 'branch version');
    writeFileSync(join(main, 'shared.txt'), 'main version');
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'main conflict edit');
    const mainBefore = git(main, 'rev-parse', 'HEAD');

    const r = runFinish(changeDir, main);

    try {
      assert.notEqual(r.status, 0, r.all);
      assert.match(r.all, /冲突/);
      assert.ok(r.all.includes('shared.txt'), `must list conflicting file, got: ${r.all}`);
      assert.equal(existsSync(worktree), true, 'worktree must survive a conflict');
      assert.notEqual(git(main, 'branch', '--list', 'finish-conflict'), '', 'branch must survive');
      assert.equal(git(main, 'rev-parse', 'HEAD'), mainBefore, 'no merge commit on conflict');
    } finally {
      // 测试清理：手动中止冲突现场，避免 afterEach 删除冲突状态目录时 git 索引残留
      try {
        git(main, 'merge', '--abort');
      } catch { /* ignore */ }
    }
  });

  it('主干验证通过（--test-cmd 注入短命令）：worktree/分支删除、退出 0', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-verify-ok-'));
    tempDirs.push(base);
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-verify-ok');
    commitFileInWorktree(worktree, 'feature.txt', 'branch work');
    const isoHead = git(main, 'rev-parse', 'finish-verify-ok');

    const r = runFinish(changeDir, main, ['--test-cmd', 'node -e "process.exit(0)"']);

    assert.equal(r.status, 0, r.all);
    // merge --no-ff 已执行且主干包含隔离分支全部提交
    const mainHead = git(main, 'rev-parse', 'HEAD');
    assert.equal(git(main, 'merge-base', '--is-ancestor', isoHead, mainHead), '');
    // 验证通过后 worktree 与隔离分支才被删除
    assert.equal(existsSync(worktree), false, 'worktree must be removed after passing verification');
    assert.equal(git(main, 'branch', '--list', 'finish-verify-ok'), '', 'isolated branch must be deleted');
  });

  it('主干验证失败（--test-cmd 注入失败命令）：不删 worktree/分支、退出非零、提示返回 worktree 修改', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-verify-fail-'));
    tempDirs.push(base);
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-verify-fail');
    commitFileInWorktree(worktree, 'feature.txt', 'branch work');

    const r = runFinish(changeDir, main, ['--test-cmd', 'node -e "process.exit(1)"']);

    assert.notEqual(r.status, 0, r.all);
    assert.match(r.all, /返回 worktree 修改/);
    assert.match(r.all, /验证/);
    // merge 已执行但验证失败 → 不删 worktree/分支
    assert.equal(existsSync(worktree), true, 'worktree must survive failed verification');
    assert.notEqual(git(main, 'branch', '--list', 'finish-verify-fail'), '', 'branch must survive');
  });

  it('--test-cmd 覆盖生效：主仓库无 package.json（默认 npm test 必失败）时自定义命令通过 → 证明执行的是自定义命令而非 npm test', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-override-'));
    tempDirs.push(base);
    // fixture 前提：主仓库不写 package.json → 若执行默认 npm test 必然非零退出。
    // --test-cmd 成功即证明验证执行的是自定义命令而非默认值。
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-override', { pkg: null });
    assert.equal(existsSync(join(main, 'package.json')), false, 'precondition: no package.json → npm test must fail');
    commitFileInWorktree(worktree, 'feature.txt', 'branch work');
    const isoHead = git(main, 'rev-parse', 'finish-override');

    const r = runFinish(changeDir, main, ['--test-cmd', 'node -e "process.exit(0)"']);

    assert.equal(r.status, 0, r.all);
    // 输出明确标注执行的是自定义命令，而非默认 npm test
    assert.ok(r.stdout.includes('验证命令：node -e "process.exit(0)"'), `must print custom cmd, got: ${r.stdout}`);
    assert.doesNotMatch(r.all, /npm test/, 'must not run default npm test');
    const mainHead = git(main, 'rev-parse', 'HEAD');
    assert.equal(git(main, 'merge-base', '--is-ancestor', isoHead, mainHead), '');
    assert.equal(existsSync(worktree), false, 'worktree must be removed after passing override verification');
    assert.equal(git(main, 'branch', '--list', 'finish-override'), '', 'isolated branch must be deleted');
  });

  it('默认验证命令为 npm test（通过）：未传 --test-cmd，package.json test 脚本退出 0 → 收尾完成、删除 worktree/分支', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-default-pass-'));
    tempDirs.push(base);
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-default-pass');
    commitFileInWorktree(worktree, 'feature.txt', 'branch work');
    const isoHead = git(main, 'rev-parse', 'finish-default-pass');

    const r = runFinish(changeDir, main);

    assert.equal(r.status, 0, r.all);
    assert.ok(r.stdout.includes('验证命令：npm test'), `must run npm test by default, got: ${r.stdout}`);
    const mainHead = git(main, 'rev-parse', 'HEAD');
    assert.equal(git(main, 'merge-base', '--is-ancestor', isoHead, mainHead), '');
    assert.equal(existsSync(worktree), false, 'worktree must be removed after passing default verification');
    assert.equal(git(main, 'branch', '--list', 'finish-default-pass'), '', 'isolated branch must be deleted');
  });

  it('默认验证命令为 npm test（失败）：test 脚本退出 1 → 不删 worktree/分支、退出非零、提示返回 worktree 修改', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-default-fail-'));
    tempDirs.push(base);
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-default-fail', {
      pkg: { name: 'main', version: '0.0.0', scripts: { test: 'node -e "process.exit(1)"' } },
    });
    commitFileInWorktree(worktree, 'feature.txt', 'branch work');

    const r = runFinish(changeDir, main);

    assert.notEqual(r.status, 0, r.all);
    assert.ok(r.stdout.includes('验证命令：npm test'), `must run npm test by default, got: ${r.stdout}`);
    assert.match(r.all, /验证失败/);
    assert.match(r.all, /返回 worktree 修改/);
    // merge 已执行但默认验证失败 → 不删 worktree/分支
    assert.equal(existsSync(worktree), true, 'worktree must survive failed default verification');
    assert.notEqual(git(main, 'branch', '--list', 'finish-default-fail'), '', 'branch must survive');
  });

  it('无隔离上下文：非零退出、提示先运行 ssf isolate、无 WARN、无 merge commit', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-none-'));
    tempDirs.push(base);
    const main = join(base, 'main');
    makeRepo(main);
    const changeDir = join(main, 'changes', 'finish-none');
    mkdirSync(changeDir, { recursive: true });

    const r = runFinish(changeDir, main);

    assert.notEqual(r.status, 0, r.all);
    assert.match(r.all, /ssf isolate/);
    assert.doesNotMatch(r.all, /WARN/, 'no worktree → no cwd WARN');
    assert.equal(git(main, 'log', '--merges', '-1', '--format=%H'), '', 'no merge commit may be created');
  });
});
