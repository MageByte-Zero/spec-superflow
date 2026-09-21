#!/usr/bin/env node
// scripts/ensure-branch.mjs — enforce git isolation before editing main/master
// Used by build-executor as a mandatory preflight. Exits non-zero when it
// cannot create an isolated context and no --force approval was given, so the
// agent MUST stop and ask the user instead of silently editing main/master.
//
// Usage: node ensure-branch.mjs <change-dir> [change-name] [--worktree] [--force]
//
// Security: every git invocation uses execFileSync with a LITERAL command
// ('git') and a LITERAL argument array (no shell, no variable args array) —
// the same form proven safe by install-cursor.mjs / install.mjs. There is no
// string-form shell command, no variable command, and no dynamic args array.
import { readIsolationContext, writeIsolationContext } from './lib/isolation-context.mjs';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  force: { type: 'boolean', default: false }, worktree: { type: 'boolean', default: false },
} });
const [changeDir, changeName] = positionals;
const force = values.force;

if (!changeDir) {
  console.error('Usage: node ensure-branch.mjs <change-dir> [change-name] [--worktree] [--force]');
  process.exit(2);
}

const PROTECTED = ['main', 'master'];
const GIT_OPTS = { encoding: 'utf-8', cwd: changeDir, stdio: ['ignore', 'pipe', 'pipe'] };

function isSafePathSegment(value) {
  return typeof value === 'string'
    && value.length > 0
    && value !== '.'
    && value !== '..'
    && !/[\\/\u0000-\u001f]/.test(value);
}

// Determine current branch (literal arg array).
let branch = '';
try {
  branch = (execFileSync('git', ['branch', '--show-current'], GIT_OPTS) || '').trim();
} catch {
  console.error('ensure-branch: could not determine current git branch. Is <change-dir> inside a git repository?');
  process.exit(1);
}

if (PROTECTED.includes(branch)) {
  console.error(`ensure-branch: on protected branch '${branch}'. Creating an isolated implementation context...`);
}

let repoRoot;
try {
  repoRoot = resolve((execFileSync('git', ['rev-parse', '--show-toplevel'], GIT_OPTS) || '').trim());
} catch {
  console.error('ensure-branch: could not determine the Git repository root.');
  process.exit(1);
}

// `git rev-parse --show-toplevel` already succeeded with cwd = changeDir, which
// proves changeDir lives inside the repository — no path-string comparison
// needed. Compute the change-dir-relative-to-root path via `git rev-parse
// --show-prefix` (not `path.relative`) so Windows 8.3 short names, junctions,
// and case mismatches between git and Node cannot yield a wrong result.
let changeRelativePath;
try {
  changeRelativePath = (execFileSync('git', ['rev-parse', '--show-prefix'], GIT_OPTS) || '').trim().replace(/[\\/]+$/, '');
} catch {
  console.error('ensure-branch: could not resolve the change directory relative to the repository root.');
  process.exit(1);
}

if (!changeRelativePath || changeRelativePath.split(/[\\/]/).some(part => part === '..' || part === '.')) {
  console.error('ensure-branch: change must be a directory strictly inside its repository.');
  process.exit(1);
}

const sourceChangeDir = resolve(changeDir);
assertPhysicalChangePath(repoRoot);
const repoName = basename(repoRoot) || 'repo';
// 默认隔离分支名 = change 目录名（与 ssf finish / review 的匹配假设一致：
// finish 与 R5 WARN 均按 refs/heads/<change-dir-basename> 查找隔离 worktree）。
const name = changeName || basename(sourceChangeDir) || repoName;
if (!isSafePathSegment(name)) {
  console.error('ensure-branch: change name must be a single safe path segment.');
  process.exit(1);
}
const worktreePath = join(dirname(repoRoot), `${repoName}-${name}`);

function assertPhysicalChangePath(root) {
  let current = root;
  for (const part of changeRelativePath.split(/[\\/]/)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('Change path must not traverse symlinks');
  }
}

function copyActiveChange(worktreeRoot, preserveExisting = false) {
  if (!existsSync(sourceChangeDir)) return;
  assertPhysicalChangePath(worktreeRoot);
  const targetChangeDir = join(worktreeRoot, changeRelativePath);
  mkdirSync(dirname(targetChangeDir), { recursive: true });
  cpSync(sourceChangeDir, targetChangeDir, {
    recursive: true,
    force: !preserveExisting,
    filter: (_source, target) => {
      if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error('Change copy must not overwrite symlinks');
      return true;
    },
    dereference: false,
    verbatimSymlinks: true,
  });
}

// Initialize every (nested) submodule in an isolated context. Literal arg array
// — no shell string. Returns false (and sets a non-zero exit code) when any
// submodule cannot be fetched, because an unbuildable worktree must stop the
// agent. The failure line is written synchronously to stderr: `console.error`
// followed by `process.exit` can drop the final line before the pipe flushes
// under Windows/pipe, silently hiding the reason.
function initSubmodules(contextDir) {
  if (!existsSync(join(contextDir, '.gitmodules'))) {
    console.log(`ensure-branch: no .gitmodules in ${contextDir}; skipping submodule initialization.`);
    return true;
  }
  console.log(`ensure-branch: initializing submodules in ${contextDir}...`);
  try {
    // A hard timeout: on Windows, `git submodule update` against an unreachable
    // file:// URL can block for minutes instead of failing fast. Cap it so a
    // broken submodule stops the agent promptly rather than hanging isolate.
    execFileSync('git', ['-C', contextDir, 'submodule', 'sync', '--recursive'], { ...GIT_OPTS, cwd: contextDir, timeout: 120000 });
    execFileSync('git', ['-C', contextDir, 'submodule', 'update', '--init', '--recursive'], { ...GIT_OPTS, cwd: contextDir, timeout: 120000 });
    return true;
  } catch (e) {
    const reason = (e.stderr || e.stdout || e.message || 'unknown').toString().trim();
    process.stderr.write(`ensure-branch: submodule initialization failed: ${reason}\n`);
    process.exitCode = 1;
    return false;
  }
}

// Append a cwd-persistence warning to the change's progress ledger. The ledger
// (and its parent directories) is created when missing; existing content is
// never overwritten.
function writeProgressWarning(contextDir) {
  const progressDir = join(changeDir, '.superpowers', 'sdd');
  const progressFile = join(progressDir, 'progress.md');
  mkdirSync(progressDir, { recursive: true });
  const entry = [
    '',
    '## cwd 警告（ensure-branch 自动写入）',
    '',
    `- 隔离上下文：\`${contextDir}\``,
    '- Bash cwd 不持续：每条命令都会回到会话初始目录，不会记住上一次的 cd',
    `- 强制规则：后续实现编辑必须使用隔离上下文内的绝对路径，或每条命令以前缀 \`cd ${contextDir} &&\` 开头`,
    '',
  ].join('\n');
  appendFileSync(progressFile, entry, 'utf-8');
  console.log(`ensure-branch: appended cwd warning to ${progressFile}`);
}

const existingContext = readIsolationContext(changeDir);
if (!PROTECTED.includes(branch) && (!values.worktree || existingContext)) {
  if (existingContext?.kind === 'worktree' && existingContext.finish_status !== 'complete'
    && realpathSync.native(existingContext.isolation_root) === realpathSync.native(repoRoot)) {
    if (existingContext.isolation_branch !== branch) {
      console.error('ensure-branch: recorded isolation branch has changed; recover provenance before edits.');
      process.exit(1);
    }
    if (existingContext.setup_status === 'initializing') {
      if (!initSubmodules(repoRoot)) process.exit(1);
      writeProgressWarning(repoRoot);
      writeIsolationContext(changeDir, { ...existingContext, setup_status: 'ready' });
    }
    console.log(`ensure-branch: existing git worktree at ${repoRoot} is ready. Proceed with implementation edits there.`);
    process.exit(0);
  }
  if (existingContext?.kind === 'branch'
    && existingContext.finish_status !== 'complete'
    && existingContext.isolation_branch === branch) {
    if (existingContext.setup_status === 'initializing') {
      if (!initSubmodules(repoRoot)) process.exit(1);
      writeProgressWarning(repoRoot);
      writeIsolationContext(changeDir, { ...existingContext, setup_status: 'ready' });
      console.log(`ensure-branch: resumed existing isolated branch '${branch}'.`);
    } else {
      console.log(`ensure-branch: already isolated on branch '${branch}'. Proceed with implementation edits.`);
    }
    process.exit(0);
  }
  if (existingContext && existingContext.finish_status !== 'complete') {
    console.error('ensure-branch: current branch differs from recorded isolation; return to the recorded branch before edits.');
    process.exit(1);
  }
  console.log(`ensure-branch: already isolated on branch '${branch}'. Proceed with implementation edits.`);
  process.exit(0);
}

if (existingContext?.kind === 'worktree'
  && existingContext.finish_status !== 'complete'
  && resolve(existingContext.target_root) === repoRoot
  && existingContext.target_branch === branch
  && existingContext.isolation_branch === name
  && resolve(existingContext.isolation_root) === resolve(worktreePath)
  && existsSync(worktreePath)) {
  let existingBranch = '';
  try {
    existingBranch = (execFileSync('git', ['-C', worktreePath, 'branch', '--show-current'], GIT_OPTS) || '').trim();
  } catch {
    console.error('ensure-branch: recorded isolation worktree is not usable.');
    process.exit(1);
  }
  if (existingBranch !== name) {
    console.error('ensure-branch: recorded isolation worktree branch no longer matches its context.');
    process.exit(1);
  }
  if (existingContext.setup_status === 'initializing') {
    if (!initSubmodules(worktreePath)) process.exit(1);
    writeProgressWarning(worktreePath);
    copyActiveChange(worktreePath, true);
    writeIsolationContext(changeDir, { ...existingContext, setup_status: 'ready' });
    console.log(`ensure-branch: resumed existing git worktree at ${worktreePath} on branch '${name}'.`);
  } else {
    console.log(`ensure-branch: existing git worktree at ${worktreePath} is ready. Proceed with implementation edits there.`);
  }
  process.exit(0);
}

if (existingContext && existingContext.finish_status !== 'complete') {
  console.error('ensure-branch: unfinished isolation no longer matches; recover the recorded checkout instead of creating another.');
  process.exit(1);
}
const reviewBase = (execFileSync('git', ['rev-parse', 'HEAD'], GIT_OPTS) || '').trim();

// Default to one checkout. Worktree creation is an explicit opt-in and never
// silently falls back to switching a different branch after a partial failure.
const kind = values.worktree ? 'worktree' : 'branch';
const isolationRoot = values.worktree ? worktreePath : repoRoot;
try {
  if (values.worktree) {
    execFileSync('git', ['worktree', 'add', worktreePath, '-b', name], { ...GIT_OPTS, stdio: 'inherit' });
  } else {
    execFileSync('git', ['switch', '-c', name], { ...GIT_OPTS, stdio: 'inherit' });
  }
} catch (error) {
  console.error(`ensure-branch: ${kind} creation failed: ${(error.stderr || error.message).toString().trim()}`);
  if (force) {
    console.error('ensure-branch: WARNING — editing protected branch in place with --force.');
    process.exit(0);
  }
  console.error('ensure-branch: preserve existing branches and directories; resolve the conflict or choose a new name.');
  process.exit(1);
}
const context = { change_name: basename(sourceChangeDir), change_relative_path: changeRelativePath,
  target_root: repoRoot, target_branch: branch, isolation_root: isolationRoot, isolation_branch: name,
  kind, finish_status: 'pending', setup_status: 'initializing', review_base: reviewBase };
writeIsolationContext(changeDir, context);
if (!initSubmodules(isolationRoot)) process.exit(1);
writeProgressWarning(isolationRoot);
if (values.worktree) copyActiveChange(worktreePath);
writeIsolationContext(changeDir, { ...context, setup_status: 'ready' });
console.log(`ensure-branch: created ${values.worktree ? 'git worktree' : 'feature branch'} at ${isolationRoot} on branch '${name}'. Make implementation edits there.`);
process.exit(0);
