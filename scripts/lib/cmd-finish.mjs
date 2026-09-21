// scripts/lib/cmd-finish.mjs — `ssf finish <change-dir> [--test-cmd <command>]` 一键收尾
// 将隔离分支合并回主干（merge --no-ff）、验证主干已包含隔离分支全部提交、
// 在主干执行验证命令（默认 npm test，--test-cmd 覆盖，10 分钟超时）、
// 清理 worktree 与隔离分支，并输出收尾报告。验证失败（含超时）停止收尾、
// 保留 worktree 与隔离分支提示重跑。错误路径一律非零退出且不 merge、
// 不删除、不破坏既有内容。
//
// 安全：所有 git 调用使用 execFileSync('git', [...]) 字面量参数数组，无
// shell 字符串拼接——与 ensure-branch.mjs / install-*.mjs 同一安全形式。
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { readIsolationContext, writeIsolationContext, archiveIsolationChange } from './isolation-context.mjs';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';

const GIT_OPTS = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };

// 可注入的 git 运行器（与 execution-plan.mjs defaultRunGit 同模式）。
// 默认 execFileSync('git', args) 字面量参数数组，无 shell 字符串拼接。
function defaultRunGit(args, options) {
  return execFileSync('git', args, options);
}

function git(root, args, io, runGit) {
  try {
    return runGit(['-C', root, ...args], GIT_OPTS).trim();
  } catch (e) {
    const err = new Error(
      (e.stderr || e.stdout || e.message || 'unknown').toString().trim()
    );
    err.status = e.status;
    err.stdout = (e.stdout || '').toString();
    err.stderr = (e.stderr || '').toString();
    throw err;
  }
}

export function verificationEnvironmentFingerprint(env = process.env) {
  const volatile = /^(?:GIT_|PWD$|OLDPWD$|SHLVL$|_$|TERM_SESSION_ID$|ITERM_|LC_TERMINAL|SSH_|XPC_|VSCODE_|CURSOR_|CLAUDE_|CODEX_|SESSION_ID$)/i;
  const stableEnvironment = Object.fromEntries(
    Object.entries(env).filter(([key]) => !volatile.test(key)).sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash('sha256').update(JSON.stringify({
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    env: stableEnvironment,
  })).digest('hex');
}

// 规范化路径：realpath 解析 8.3 短名/junction，失败时退化为 resolve。
// 必须用 native 版本：JS 版 realpathSync 无法解析 8.3 短名组件（组件名
// 与 readdir 结果不匹配 → ENOENT → 保留短形式），CI Windows runner 的
// TEMP 是 C:\Users\RUNNER~1\... 短名形式，与 git 输出的长路径比较会误判。
function normPath(p) {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
}

// child 是否位于 parent 内（大小写不敏感，兼容 Windows 盘符）。
// 导出供测试验证 8.3 短路径兼容性（path-normalization.test.mjs）。
export function isSubpath(parent, child) {
  const p = normPath(parent).toLowerCase();
  const c = normPath(child).toLowerCase();
  return c === p || c.startsWith(p + sep);
}

// 解析 `git worktree list --porcelain`：返回 [{ path, branch }]。
// 每个条目以空行分隔；branch 行仅在非 detached 状态出现。
function parseWorktreeList(output) {
  const entries = [];
  for (const block of output.split(/\n[ \t]*\n/)) {
    const lines = block.split('\n').map(line => line.trim());
    if (!lines[0]) continue;
    const entry = { path: null, branch: null };
    for (const line of lines) {
      if (line.startsWith('worktree ')) entry.path = resolve(line.slice('worktree '.length));
      else if (line.startsWith('branch ')) entry.branch = line.slice('branch '.length);
    }
    if (entry.path) entries.push(entry);
  }
  return entries;
}

export function run(args, io = { stdout: process.stdout, stderr: process.stderr }, runGit = defaultRunGit) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { 'test-cmd': { type: 'string' } },
  });
  const changeDir = positionals[0];
  if (!changeDir) {
    io.stderr.write('Usage: ssf finish <change-dir> [--test-cmd <command>]\n');
    return { exitCode: 2 };
  }

  try {
    const currentRoot = resolve(git(changeDir, ['rev-parse', '--show-toplevel'], io, runGit));
    const list = parseWorktreeList(git(currentRoot, ['worktree', 'list', '--porcelain'], io, runGit));
    let context = readIsolationContext(changeDir);
    if (!context) {
      // Legacy contexts are accepted only when both sides can be resolved uniquely.
      const name = basename(resolve(changeDir));
      const isolated = list.filter(item => item.branch === `refs/heads/${name}`);
      const targets = list.filter(item => ['refs/heads/main', 'refs/heads/master'].includes(item.branch)
        && item.path !== isolated[0]?.path);
      if (isolated.length !== 1 || targets.length !== 1) {
        throw new Error('不存在可靠隔离上下文或目标不明确；请先运行 ssf isolate 并记录目标');
      }
      context = { change_name: name, target_root: targets[0].path, target_branch: targets[0].branch.slice(11),
        isolation_root: isolated[0].path, isolation_branch: name, kind: 'worktree', finish_status: 'pending' };
    }
    if (context.finish_status === 'complete') {
      io.stdout.write('finish: 收尾完成（此前已完成）。\n');
      return { exitCode: 0 };
    }
    const mainRoot = context.target_root;
    const common = root => normPath(resolve(root, git(root, ['rev-parse', '--git-common-dir'], io, runGit)));
    if (common(mainRoot) !== common(currentRoot)) throw new Error('recorded target belongs to a different Git repository');
    const worktreePath = context.isolation_root;
    const name = context.isolation_branch;
    if (name === context.target_branch || (context.kind !== 'branch' && normPath(mainRoot) === normPath(worktreePath))) {
      throw new Error('isolation and target must be distinct');
    }
    const persist = () => writeIsolationContext(mainRoot, context);
    const isolatedExists = list.some(item => normPath(item.path) === normPath(worktreePath)
      && item.branch === `refs/heads/${name}`);
    const isolationStatus = isolatedExists ? git(worktreePath, ['status', '--porcelain'], io, runGit) : '';
    if (isolationStatus) throw new Error(`隔离 worktree 存在未提交改动，停止收尾：\n${isolationStatus}`);
    if (context.kind === 'branch' && isolatedExists) {
      git(mainRoot, ['switch', context.target_branch], io, runGit);
    }
    if (git(mainRoot, ['branch', '--show-current'], io, runGit) !== context.target_branch) {
      throw new Error('target checkout is no longer on the recorded target branch');
    }
    if (git(mainRoot, ['status', '--porcelain'], io, runGit)) throw new Error('target checkout has uncommitted changes');
    let isoHead;
    let branchExists = true;
    try { isoHead = git(mainRoot, ['rev-parse', '--verify', `refs/heads/${name}`], io, runGit); }
    catch (error) {
      if (context.finish_status !== 'cleanup-pending' || !context.isolation_head || isolatedExists) throw error;
      isoHead = context.isolation_head;
      branchExists = false;
    }
    if (!context.review_base) {
      context.review_base = git(mainRoot, ['merge-base', 'HEAD', isoHead], io, runGit);
      persist();
    }
    let contained = false;
    try { git(mainRoot, ['merge-base', '--is-ancestor', isoHead, 'HEAD'], io, runGit); contained = true; } catch {}
    if (!contained) {
      try { git(mainRoot, ['merge', '--no-ff', name], io, runGit); }
      catch (error) { throw new Error(`合并失败（可能存在冲突，请手动解决）：${error.message}`); }
    }
    git(mainRoot, ['merge-base', '--is-ancestor', isoHead, 'HEAD'], io, runGit);
    const mainHead = git(mainRoot, ['rev-parse', 'HEAD'], io, runGit);
    const verifyCmd = values['test-cmd'] || 'npm test';
    const environment = verificationEnvironmentFingerprint();
    // A prior process cannot attest that ignored dependencies, local config or
    // external services stayed unchanged. Revalidate each unfinished attempt.
    {
      context.finish_status = 'verify-pending';
      persist();
      io.stdout.write(`finish: merge --no-ff 成功（commit ${mainHead}），开始主干验证…\n`);
      io.stdout.write(`finish: 在主干执行验证命令：${verifyCmd}\n`);
      try { execFileSync(verifyCmd, { cwd: mainRoot, shell: true, timeout: 600000, stdio: 'inherit' }); }
      catch (error) {
        if (context.kind === 'branch' && !git(mainRoot, ['status', '--porcelain'], io, runGit)) {
          git(mainRoot, ['switch', name], io, runGit);
        }
        throw new Error(`主干验证失败：${error.message}。在记录的隔离分支修复后重试；若验证产生未提交改动，先保留并处理这些改动`);
      }
      if (git(mainRoot, ['rev-parse', 'HEAD'], io, runGit) !== mainHead
        || git(mainRoot, ['branch', '--show-current'], io, runGit) !== context.target_branch
        || git(mainRoot, ['status', '--porcelain'], io, runGit)) {
        throw new Error('Verification changed the target checkout; preserve changes and diagnose before cleanup');
      }
      context.verified_head = mainHead;
      context.verified_command = verifyCmd;
      context.verified_environment = environment;
    }
    context.isolation_head = isoHead;
    context.finish_status = 'cleanup-pending';
    persist();
    if (context.kind !== 'branch' && isolatedExists) {
      // Verify again after tests. Never force-delete untracked files or submodules.
      if (git(worktreePath, ['status', '--porcelain'], io, runGit)) throw new Error('isolation changed during verification; cleanup stopped');
      context.change_archive = archiveIsolationChange(changeDir, context);
      persist();
      if (isSubpath(worktreePath, process.cwd())) process.chdir(mainRoot);
      git(mainRoot, ['worktree', 'remove', worktreePath], io, runGit);
    }
    if (branchExists) git(mainRoot, ['branch', '-d', name], io, runGit);
    context.finish_status = 'complete';
    persist();
    io.stdout.write(`finish: 收尾完成。\n- merge commit: ${mainHead}\n- worktree 已移除: ${context.kind === 'branch' ? 'branch-only checkout retained' : worktreePath}\n- 隔离分支已删除: ${name}\n`);
    return { exitCode: 0 };
  } catch (error) {
    io.stderr.write(`finish: ${error.message}；保留尚未清理的隔离上下文，可修复后重试。\n`);
    return { exitCode: 1 };
  }
}
