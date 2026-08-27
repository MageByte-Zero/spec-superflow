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
import { realpathSync } from 'node:fs';

const GIT_OPTS = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };

function git(root, args, io) {
  try {
    return execFileSync('git', ['-C', root, ...args], GIT_OPTS).trim();
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

// 规范化路径：realpath 解析 8.3 短名/junction，失败时退化为 resolve。
function normPath(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

// child 是否位于 parent 内（大小写不敏感，兼容 Windows 盘符）。
function isSubpath(parent, child) {
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

export function run(args, io = { stdout: process.stdout, stderr: process.stderr }) {
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

  // 隔离分支名 = change 目录名（ensure-branch 以 change-name 命名分支）。
  const name = basename(resolve(changeDir));

  // 主仓库根：change-dir 必须在仓库内。
  let mainRoot;
  try {
    mainRoot = resolve(git(changeDir, ['rev-parse', '--show-toplevel'], io));
  } catch (e) {
    io.stderr.write(`finish: ${changeDir} 不在任何 git 仓库内：${e.message}\n`);
    return { exitCode: 1 };
  }

  // 1. 定位隔离 worktree（按隔离分支名匹配）。
  const list = parseWorktreeList(git(mainRoot, ['worktree', 'list', '--porcelain'], io));
  const entry = list.find(item => item.branch === `refs/heads/${name}`);
  if (!entry) {
    io.stderr.write(
      `finish: change '${changeDir}' 不存在隔离上下文（未找到分支 '${name}' 的 worktree）。` +
      '请先运行 `ssf isolate` 创建隔离上下文后再执行 finish。\n'
    );
    return { exitCode: 1 };
  }
  const worktreePath = entry.path;

  // 5. cwd 越界 WARN：cwd 不在隔离 worktree 内时输出一行警告，不阻断。
  if (!isSubpath(worktreePath, process.cwd())) {
    io.stdout.write(
      `WARN: 进程 cwd（${process.cwd()}）不在隔离 worktree 内。worktree 绝对路径：${worktreePath}；` +
      '实现编辑必须使用 worktree 内路径，或每条命令以前缀 `cd <worktree> &&` 开头。\n'
    );
  }

  // 2. 校验 worktree 工作树干净；存在未提交改动则停止并列出路径。
  const status = git(worktreePath, ['status', '--porcelain'], io);
  if (status) {
    io.stderr.write(
      `finish: 隔离 worktree 存在未提交改动，停止收尾。未提交路径：\n${status}\n` +
      '请先在 worktree 内提交或清理改动，再重试 `ssf finish`。\n'
    );
    return { exitCode: 1 };
  }

  // 3. 在主仓库当前分支（主干）执行 merge --no-ff。
  let mergeOut;
  try {
    mergeOut = git(mainRoot, ['merge', '--no-ff', name], io);
  } catch (e) {
    // 冲突检测：unmerged 路径非空即 merge 冲突。不自动解决，保留现场由用户手动处理。
    const unmerged = git(mainRoot, ['diff', '--name-only', '--diff-filter=U'], io);
    if (unmerged) {
      io.stderr.write(
        `finish: git merge --no-ff ${name} 产生冲突，停止收尾。冲突文件需手动解决：\n${unmerged}\n` +
        'finish 未自动解决冲突、未删除 worktree 与隔离分支，请手动解决后重试。\n'
      );
    } else {
      io.stderr.write(`finish: git merge --no-ff ${name} 失败：${e.message}\n`);
    }
    return { exitCode: 1 };
  }

  // 4. 同步验证：隔离分支 head 必须是主干 head 的祖先（主干已包含全部提交）。
  let isoHead, mainHead;
  try {
    isoHead = git(mainRoot, ['rev-parse', name], io);
    mainHead = git(mainRoot, ['rev-parse', 'HEAD'], io);
    git(mainRoot, ['merge-base', '--is-ancestor', isoHead, mainHead], io);
  } catch {
    io.stderr.write(
      'finish: 同步验证失败——隔离分支 head 不是主干 head 的祖先，主干未包含隔离分支全部提交。' +
      '请检查仓库状态后重试。\n'
    );
    return { exitCode: 1 };
  }

  // 5. 主干验证：merge --no-ff 成功且同步验证通过后、删除 worktree 前，
  // 在主仓库主干（当前分支）的 cwd 执行验证命令（默认 npm test，
  // --test-cmd <command> 覆盖），10 分钟超时。
  // --test-cmd 是用户显式信任的命令，shell: true 是唯一 shell 例外；
  // git 调用仍保持 execFileSync 数组字面量形式。
  const verifyCmd = values['test-cmd'] || 'npm test';
  io.stdout.write(`finish: 在主干执行验证命令：${verifyCmd}\n`);
  try {
    execFileSync(verifyCmd, { cwd: mainRoot, shell: true, timeout: 600000, stdio: 'inherit' });
  } catch (e) {
    const isTimeout = e.code === 'ETIMEDOUT';
    const reason = isTimeout
      ? '验证命令超时（超过 10 分钟）'
      : `验证命令以非零状态退出（exit ${e.status ?? 'unknown'}）`;
    const detail = e.message ? `：${e.message}` : '';
    io.stderr.write(
      `finish: 主干验证失败——${reason}${detail}\n` +
      `- 验证命令: ${verifyCmd}\n` +
      `- 已执行 merge --no-ff，但未删除 worktree 与隔离分支。\n` +
      '请返回 worktree 修改后重跑 `ssf finish`。\n'
    );
    return { exitCode: 1 };
  }

  // 6. 清理：先移除 worktree（已校验干净），再删除隔离分支。
  // Windows 无法删除作为进程 cwd 的目录，故若 cwd 位于 worktree 内，
  // 先把进程 cwd 切回主仓库再执行移除。
  if (isSubpath(worktreePath, process.cwd())) {
    try {
      process.chdir(mainRoot);
    } catch { /* 忽略——移除仍会尝试，失败由下方错误路径处理 */ }
  }
  try {
    git(mainRoot, ['worktree', 'remove', worktreePath], io);
  } catch (e) {
    io.stderr.write(`finish: worktree 移除失败：${e.message}\n`);
    return { exitCode: 1 };
  }
  try {
    git(mainRoot, ['branch', '-d', name], io);
  } catch (e) {
    io.stderr.write(`finish: 隔离分支删除失败：${e.message}\n`);
    return { exitCode: 1 };
  }

  // 7. 输出收尾报告。
  io.stdout.write(
    `finish: 收尾完成。\n` +
    `- merge commit: ${mainHead}\n` +
    `- worktree 已移除: ${worktreePath}\n` +
    `- 隔离分支已删除: ${name}\n` +
    (mergeOut ? `- merge 输出: ${mergeOut}\n` : '')
  );
  return { exitCode: 0 };
}
