// tests/lib/cmd-finish.test.mjs
// `ssf finish <change-dir>` — merge 隔离分支回主干（--no-ff）、验证同步、
// 清理 worktree 与隔离分支、错误路径（未提交改动 / merge 冲突 / 无隔离上下文）
// 以及 cwd 越界 WARN。全部通过真实 git 操作 + 真实 CLI 进程完成。
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { run as finishRun } from '../../scripts/lib/cmd-finish.mjs';

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
    env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file', ...GIT_IDENTITY_ENV },
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

// CI runner 无全局 git 身份，finish 的 merge --no-ff 创建 merge commit 时
// 会报 "Committer identity unknown"（Ubuntu CI 实际故障）。所有 spawn 的
// 子进程统一注入身份 env；-c 参数只对直接调用的 git 进程生效，覆盖不到
// finish 内部 spawn 的 npm test / git 子进程链。
const GIT_IDENTITY_ENV = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 't@t',
};

function runFinish(changeDir, cwd, extraArgs = []) {
  const r = spawnSync(process.execPath, [CLI, 'finish', changeDir, ...extraArgs], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, ...GIT_IDENTITY_ENV },
  });
  return {
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    all: `${r.stdout || ''}\n${r.stderr || ''}`,
  };
}

// 进程内调用 finish 的 run()，注入 runGit 使指定 git 子命令首次调用抛错。
// forceRemoveFirstCall: 'plain' → 拦截无 --force 的 worktree remove；
// 'all' → 拦截所有 worktree remove。被拦截的调用抛出含原因的 Error，
// 其余 git 调用透传真实 git。返回 { exitCode, stdout, stderr, all }。
function runFinishInProcess(changeDir, cwd, { blockRemove = 'plain' } = {}) {
  const out = [];
  const err = [];
  const io = { stdout: { write: s => out.push(s) }, stderr: { write: s => err.push(s) } };
  const realRunGit = (args, options) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=test', ...args], {
    encoding: 'utf8', ...(options || {}),
  });
  const runGit = (args, options) => {
    const isRemove = args.includes('worktree') && args.includes('remove');
    const forced = args.includes('--force');
    const blocked = blockRemove === 'all' || (blockRemove === 'plain' && !forced);
    if (isRemove && blocked) {
      throw new Error('fixture: worktree remove blocked（模拟 submodule 占用场景）');
    }
    return realRunGit(args, options);
  };
  const prevCwd = process.cwd();
  process.chdir(cwd);
  try {
    const result = finishRun([changeDir], io, runGit);
    return { exitCode: result?.exitCode ?? 0, stdout: out.join(''), stderr: err.join(''), all: `${out.join('')}\n${err.join('')}` };
  } finally {
    process.chdir(prevCwd);
  }
}

describe('ssf finish — force fallback 与 merge 即时反馈（closing-finish-alignment R2/R3）', () => {
  it('R2a force 兜底成功：首次 remove 失败 → WARN + --force 重试 → 报告标注 force removed、worktree/分支真实删除、退出 0', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-force-ok-'));
    tempDirs.push(base);
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-force-ok');
    commitFileInWorktree(worktree, 'feature.txt', 'branch work');

    const r = runFinishInProcess(changeDir, main, { blockRemove: 'plain' });

    assert.equal(r.exitCode, 0, r.all);
    // WARN 包含首次失败原因与 force 重试意图
    assert.match(r.all, /WARN: worktree remove 失败/);
    assert.match(r.all, /--force/);
    // 报告标注 force 移除
    assert.match(r.all, /force removed/);
    // worktree 与隔离分支真实删除
    assert.equal(existsSync(worktree), false, 'worktree must be removed');
    assert.equal(git(main, 'branch', '--list', 'finish-force-ok'), '', 'isolated branch must be deleted');
    // merge commit 存在且在报告中
    const mergeCommit = git(main, 'log', '--merges', '-1', '--format=%H');
    assert.ok(r.all.includes(mergeCommit), 'report must include merge commit');
  });

  it('R2b force 也失败：手动指引含 merge sha 与两条命令、branch -d 仍被尝试并成功、退出 1、worktree 残留', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-force-fail-'));
    tempDirs.push(base);
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-force-fail');
    // 手动指引里的 worktree 路径经生产代码 native realpath 规范化（git
    // 返回长路径形式）；CI Windows 的 TEMP 是 8.3 短名，断言须用同形式，
    // 且必须在收尾删除前捕获（该路径本测试中保留，但统一防御 ENOENT）。
    const worktreeReal = realpathSync.native(worktree);
    commitFileInWorktree(worktree, 'feature.txt', 'branch work');
    const mergeShaBefore = git(main, 'rev-parse', 'finish-force-fail');

    const r = runFinishInProcess(changeDir, main, { blockRemove: 'all' });

    assert.equal(r.exitCode, 1, r.all);
    // 手动指引：merge 已成功（commit sha）
    assert.match(r.all, /merge 已成功（commit [0-9a-f]{40}）/);
    // 两条手动命令
    assert.ok(r.all.includes(`git worktree remove --force ${worktreeReal}`), r.all);
    assert.ok(r.all.includes('git branch -d finish-force-fail'), r.all);
    // branch -d 仍被尝试：worktree 残留时分支仍被其检出，真实 git 的
    // branch -d 必然失败 → finish 必须如实报告删除失败而非静默跳过。
    assert.match(r.all, /隔离分支删除失败/);
    assert.notEqual(git(main, 'branch', '--list', 'finish-force-fail'), '', 'branch must survive (still checked out by surviving worktree)');
    // worktree 残留
    assert.equal(existsSync(worktree), true, 'worktree must survive when --force also fails');
    assert.ok(mergeShaBefore, 'fixture sanity');
  });

  it('R3a merge 即时反馈：成功路径 stdout 在验证命令输出之前含 "merge --no-ff 成功（commit <sha>）"', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-feedback-ok-'));
    tempDirs.push(base);
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-feedback-ok');
    commitFileInWorktree(worktree, 'feature.txt', 'branch work');

    const r = runFinish(changeDir, main);

    assert.equal(r.status, 0, r.all);
    const mergeCommit = git(main, 'log', '--merges', '-1', '--format=%H');
    const fbIdx = r.stdout.indexOf(`merge --no-ff 成功（commit ${mergeCommit}）`);
    assert.notEqual(fbIdx, -1, `stdout must contain merge feedback with sha, got: ${r.stdout}`);
    const verifyIdx = r.stdout.indexOf('在主干执行验证命令');
    assert.ok(fbIdx < verifyIdx, 'merge feedback must precede the verification command line');
  });

  it('R3b merge 即时反馈：验证失败路径该行仍存在且位于失败信息之前（merge 已发生）', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-feedback-fail-'));
    tempDirs.push(base);
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-feedback-fail');
    commitFileInWorktree(worktree, 'feature.txt', 'branch work');

    const r = runFinish(changeDir, main, ['--test-cmd', 'node -e "process.exit(1)"']);

    assert.notEqual(r.status, 0, r.all);
    const mergeCommit = git(main, 'log', '--merges', '-1', '--format=%H');
    assert.ok(mergeCommit, 'merge must have happened');
    const fbIdx = r.all.indexOf(`merge --no-ff 成功（commit ${mergeCommit}）`);
    assert.notEqual(fbIdx, -1, `feedback line must exist on verify-failure path, got: ${r.all}`);
    const failIdx = r.all.indexOf('主干验证失败');
    assert.notEqual(failIdx, -1, 'failure message must exist');
    assert.ok(fbIdx < failIdx, 'merge feedback must precede the failure message');
  });

  it('R3c 失败路径（merge 冲突）不输出 merge 成功反馈行', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-feedback-conflict-'));
    tempDirs.push(base);
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-feedback-conflict');
    commitFileInWorktree(worktree, 'shared.txt', 'branch version');
    writeFileSync(join(main, 'shared.txt'), 'main version');
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'main conflict edit');

    const r = runFinish(changeDir, main);

    try {
      assert.notEqual(r.status, 0, r.all);
      assert.doesNotMatch(r.all, /merge --no-ff 成功/, 'conflict path must not print merge feedback');
    } finally {
      try { git(main, 'merge', '--abort'); } catch { /* ignore */ }
    }
  });

  it('R2c 回归：无 remove 失败时无 WARN 无 force 标注（注入透传真实 git 的正常收尾）', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-force-clean-'));
    tempDirs.push(base);
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-force-clean');
    commitFileInWorktree(worktree, 'feature.txt', 'branch work');

    const r = runFinishInProcess(changeDir, main, { blockRemove: 'none' });

    assert.equal(r.exitCode, 0, r.all);
    assert.doesNotMatch(r.all, /WARN: worktree remove 失败/);
    assert.doesNotMatch(r.all, /force removed/);
    assert.equal(existsSync(worktree), false, 'worktree must be removed');
    assert.equal(git(main, 'branch', '--list', 'finish-force-clean'), '', 'branch must be deleted');
  });
});

describe('ssf finish — 一键收尾（worktree-lifecycle R3/R5）', () => {
  it('标准收尾：merge --no-ff 提交存在、worktree/分支删除、退出 0（cwd=主仓库时含 cwd WARN 但不阻断）', () => {
    const base = mkdtempSync(join(tmpdir(), 'ssf-finish-ok-'));
    tempDirs.push(base);
    const { main, changeDir, worktree } = createIsolatedWorktree(base, 'finish-ok');
    // WARN 路径断言用的规范化形式必须在收尾删除 worktree 之前捕获
    //（realpath 对已删除路径抛 ENOENT）。CI Windows 的 TEMP 是 8.3 短名
    //（RUNNER~1），生产代码经 native realpath 规范化输出，断言须用同形式。
    const worktreeReal = realpathSync.native(worktree);
    commitFileInWorktree(worktree, 'feature.txt', 'branch work');
    const isoHead = git(main, 'rev-parse', 'finish-ok');

    const r = runFinish(changeDir, main);

    assert.equal(r.status, 0, r.all);
    // cwd=主仓库不在 worktree 内 → 输出一行含 worktree 绝对路径的 WARN，但不阻断
    assert.match(r.all, /WARN/);
    assert.ok(r.all.includes(worktreeReal), `WARN must contain worktree path ${worktreeReal}`);
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
