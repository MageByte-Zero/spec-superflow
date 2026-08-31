import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { getPlanScopedPaths } from '../../scripts/lib/sdd-overlay.mjs';
import { run as runExecution } from '../../scripts/lib/cmd-execution.mjs';
import { readState, writeState, rebuildState } from '../../scripts/lib/state-loader.mjs';
import { computeArtifactsHash, computeContractHash } from '../../scripts/lib/hash.mjs';
import { createGitSeedFixture } from '../helpers/git-seed-fixture.mjs';
import { canCreateSymlink } from '../helpers/symlink-support.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CLI = join(ROOT, 'scripts', 'spec-superflow.mjs');
const ENSURE = join(ROOT, 'scripts', 'ensure-branch.mjs');

const tempDirs = [];

let changeDir;
let gitRefs;
let fixture;

function runSsf(args, cwd = process.cwd(), { confirmPlan = true, acknowledgePlan = true, prepareRecommendation = true } = {}) {
  const isPlan = args[0] === 'execution' && ['plan', 'revise'].includes(args[1]);
  let effectiveArgs = args;
  if (confirmPlan && isPlan && !effectiveArgs.includes('--confirm')) effectiveArgs = [...effectiveArgs, '--confirm'];
  if (confirmPlan && acknowledgePlan && isPlan && requiresAcknowledgement(effectiveArgs) && !effectiveArgs.includes('--acknowledge-recommendation')) {
    effectiveArgs = [...effectiveArgs, '--acknowledge-recommendation'];
  }
  if (prepareRecommendation && isPlan) {
    const changePath = effectiveArgs[2];
    const waves = effectiveArgs.flatMap((value, index) => value === '--wave' ? ['--wave', effectiveArgs[index + 1]] : []).filter(Boolean);
    try {
      runExecutionInProcess(['recommend', changePath, ...waves]);
    } catch {
      // Let the requested command report malformed arguments through the usual test helper.
    }
  }
  if (effectiveArgs[0] === 'execution') return runExecutionInProcess(effectiveArgs.slice(1));
  if (effectiveArgs[0] === 'state') return runStateInProcess(effectiveArgs.slice(1));
  throw new Error(`Test helper has no in-process boundary for ${effectiveArgs[0]}`);
}

function runExecutionInProcess(args) {
  const output = { stdout: '', stderr: '' };
  const io = {
    stdout: { write: text => { output.stdout += text; } },
    stderr: { write: text => { output.stderr += text; } },
  };
  try {
    const result = runExecution(args, io);
    return { exitCode: result.exitCode, ...output, json: tryJson(output.stdout) };
  } catch (error) {
    return { exitCode: 1, ...output, stderr: `${output.stderr}${error.message}\n`, json: tryJson(output.stdout) };
  }
}

function runStateInProcess(args) {
  const [subcommand, directory, field, value] = args;
  const useJson = args.includes('--json');
  const output = { stdout: '', stderr: '' };
  try {
    if (subcommand === 'init') {
      mkdirSync(directory, { recursive: true });
      rebuildState(directory, { computeArtifactsHash, computeContractHash });
      output.stdout = useJson
        ? JSON.stringify({ ok: true, artifacts_hash: computeArtifactsHash(directory), contract_hash: computeContractHash(directory) })
        : 'State initialized.\n';
    } else if (subcommand === 'get') {
      const state = readState(directory);
      output.stdout = useJson ? JSON.stringify({ field, value: state[field] ?? null }) : `${state[field] ?? 'null'}\n`;
    } else if (subcommand === 'set') {
      const state = readState(directory);
      state[field] = value;
      writeState(directory, state);
      output.stdout = useJson ? JSON.stringify({ ok: true, field, value }) : `Set ${field}.\n`;
    } else {
      throw new Error(`unsupported in-process state subcommand: ${subcommand}`);
    }
    return { exitCode: 0, ...output, json: tryJson(output.stdout) };
  } catch (error) {
    return { exitCode: 1, ...output, stderr: `${error.message}\n`, json: tryJson(output.stdout) };
  }
}

function requiresAcknowledgement(args) {
  if (args[1] === 'revise') return false;
  const mode = args[args.indexOf('--mode') + 1];
  const waves = args.flatMap((value, index) => value === '--wave' ? [args[index + 1]] : []).filter(Boolean);
  const hasParallelWave = waves.some(wave => wave.split(':')[1] === 'parallel');
  const plannedTaskCount = waves.reduce((count, wave) => count + (wave.split(':')[2]?.split(',').filter(Boolean).length || 0), 0);
  const isSddRecommendation = hasParallelWave || waves.length > 1 || plannedTaskCount > 3;
  const recommendedMode = isSddRecommendation ? 'sdd' : plannedTaskCount === 1 ? 'inline' : 'batch-inline';
  return mode !== recommendedMode;
}

function runGit(directory, args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}

function tryJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function writeChangeDirectory(directory, workflow = 'full', revision = null) {
  writeFileSync(join(directory, 'proposal.md'), '## Why\nEnough context to create a controlled execution plan.\n## What Changes\n- Guard execution.\n');
  writeFileSync(join(directory, 'design.md'), '# Design\n');
  writeFileSync(join(directory, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 First task\n- [ ] 1.2 Second task\n');
  writeFileSync(join(directory, 'execution-contract.md'), '# Execution Contract\n');
  mkdirSync(join(directory, 'specs', 'execution'), { recursive: true });
  writeFileSync(join(directory, 'specs', 'execution', 'spec.md'), '## ADDED Requirements\n### Requirement: Guarded execution\nThe system SHALL guard execution.\n#### Scenario: Create plan\n- **WHEN** a plan is created\n- **THEN** it is persisted.\n');
  writeFileSync(join(directory, '.spec-superflow.yaml'), [
    'state: approved-for-build',
    `workflow: ${workflow}`,
    revision === null ? null : `revision: ${revision}`,
    '',
  ].filter(line => line !== null).join('\n'));
}

function writeReviewReport(name, content = 'Review completed without blocking findings.\n') {
  const reportsDir = join(changeDir, '.superpowers', 'sdd', 'reviews');
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, name);
  writeFileSync(reportPath, content);
  return reportPath;
}

function currentReceiptPath(waveId) {
  const plan = JSON.parse(readFileSync(join(changeDir, '.superpowers', 'sdd', 'execution-plan.json'), 'utf8'));
  return join(getPlanScopedPaths(changeDir, plan).reviews, `${Buffer.from(waveId, 'utf8').toString('base64url')}.json`);
}

function createRepairCommit(label) {
  const marker = join(changeDir, `repair-${label}.txt`);
  writeFileSync(marker, `${label}\n`);
  runGit(changeDir, ['add', marker]);
  runGit(changeDir, ['commit', '--quiet', '--message', `repair ${label}`]);
  // R4: 让隔离分支跟随默认分支的新提交，使 head 始终被非 protected 分支包含
  runGit(changeDir, ['branch', '-f', 'test-isolation', 'HEAD']);
  return runGit(changeDir, ['rev-parse', 'HEAD']);
}

function writeReviewReportIn(directory, name, content = 'Review completed without blocking findings.\n') {
  const reportsDir = join(directory, '.superpowers', 'sdd', 'reviews');
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, name);
  writeFileSync(reportPath, content);
  return reportPath;
}

// R5 fixture：主仓库 + changes/<name> change 目录（planning 产物被 /changes 忽略）。
function makeRepo(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), 'x');
  writeFileSync(join(dir, '.gitignore'), '/changes\n');
  runGit(dir, ['init', '-q']);
  runGit(dir, ['config', 'user.email', 't@t']);
  runGit(dir, ['config', 'user.name', 'test']);
  runGit(dir, ['add', '-A']);
  runGit(dir, ['commit', '-q', '-m', 'init']);
}

function createReviewPlan(directory) {
  const result = runSsf(['execution', 'plan', directory, '--mode', 'sdd',
    '--reason', 'full workflow default', '--wave', 'wave-1:serial:1.1']);
  assert.equal(result.exitCode, 0, result.stderr);
}

function commitFileInWorktree(worktree, rel, content) {
  const p = join(worktree, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  runGit(worktree, ['add', '-A']);
  runGit(worktree, ['commit', '-q', '-m', `add ${rel}`]);
}

function runReviewCli(directory, reviewArgs, cwd) {
  const r = spawnSync(process.execPath, [CLI, 'execution', 'review', directory, ...reviewArgs], {
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

before(() => {
  fixture = createGitSeedFixture({
    setup: writeChangeDirectory,
    initialCommitMessage: 'initial execution change',
    secondCommit: {
      path: 'git-range-marker.txt',
      content: 'second commit\n',
      message: 'second execution change',
    },
    prefix: 'ssf-execution-cmd-seed-',
    copyPrefix: 'ssf-execution-cmd-',
  });
});

beforeEach(() => {
  changeDir = fixture.createCopy();
  gitRefs = {
    base: fixture.base,
    head: fixture.head,
    divergent: runGit(changeDir, ['commit-tree', `${fixture.head}^{tree}`, '-m', 'independent execution change']),
  };
  // R4: head 须被至少一个非 protected 分支包含。seed 默认分支为 master
  // （protected），既有 review 用例直接使用该分支上的 head；建立一个指向
  // head 的非 protected 隔离分支，使分支校验放行，保持既有行为不变。
  runGit(changeDir, ['branch', 'test-isolation', fixture.head]);
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
});

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

after(() => {
  fixture.dispose();
});

describe('ssf execution', () => {
  it('records DP-4 and state summary after a user-confirmed recommended SDD plan', () => {
    const result = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
      '--reason', 'full workflow default', '--wave', 'wave-1:parallel:1.1,1.2', '--json']);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.plan.mode, 'sdd');
    assert.equal(result.json.plan.revision, 1);
    assert.equal(runSsf(['state', 'get', changeDir, 'execution_mode', '--json']).json.value, 'sdd');
    assert.match(runSsf(['state', 'get', changeDir, 'execution_plan_hash', '--json']).json.value, /^sha256:/);
    assert.equal(runSsf(['state', 'get', changeDir, 'execution_plan_revision', '--json']).json.value, 1);
    assert.match(runSsf(['state', 'get', changeDir, 'dp_4_result', '--json']).json.value, /plan revision 1/);
  });

  it('lists applicable execution modes and recommends one from the change evidence', () => {
    const result = runSsf(['execution', 'recommend', changeDir, '--json']);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.json.recommendation.available_modes, ['inline', 'batch-inline', 'sdd']);
    assert.equal(result.json.recommendation.recommendation.mode, 'batch-inline');
    assert.equal(result.json.recommendation.facts.documented_task_count, 2);
  });

  it('requires a current persisted recommendation before a plan can be confirmed', () => {
    const result = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--confirm',
      '--reason', 'independent implementation', '--wave', 'wave-1:parallel:1.1,1.2', '--json'], process.cwd(), {
      prepareRecommendation: false,
    });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /recommend/i);
  });

  it('rejects a mode that is not available for the current workflow', () => {
    const workflow = runSsf(['state', 'set', changeDir, 'workflow', 'tweak']);
    assert.equal(workflow.exitCode, 0, workflow.stderr);
    const recommended = runSsf(['execution', 'recommend', changeDir,
      '--wave', 'wave-1:serial:1.1']);
    assert.equal(recommended.exitCode, 0, recommended.stderr);

    const result = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--confirm',
      '--acknowledge-recommendation', '--reason', 'operator wants delegated review',
      '--wave', 'wave-1:serial:1.1'], process.cwd(), { prepareRecommendation: false });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /available|mode/i);
  });

  it('rejects a plan when the saved recommendation was for different waves', () => {
    const recommended = runSsf(['execution', 'recommend', changeDir,
      '--wave', 'wave-1:serial:1.1,1.2']);
    assert.equal(recommended.exitCode, 0, recommended.stderr);

    const result = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--confirm',
      '--reason', 'independent implementation', '--wave', 'wave-1:parallel:1.1,1.2', '--json'], process.cwd(), {
      prepareRecommendation: false,
    });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /recommend/i);
  });

  it('requires a user confirmation before recording any execution plan', () => {
    const result = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
      '--reason', 'independent implementation', '--wave', 'wave-1:parallel:1.1,1.2', '--json'], process.cwd(), { confirmPlan: false });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /confirm/i);
  });

  it('records an acknowledged non-recommended selection instead of an override', () => {
    const result = runSsf(['execution', 'plan', changeDir, '--mode', 'inline', '--confirm',
      '--acknowledge-recommendation', '--reason', 'operator will keep this focused',
      '--wave', 'wave-1:serial:1.1,1.2', '--json']);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.plan.mode, 'inline');
    assert.equal(result.json.plan.source, 'user-confirmed');
    assert.equal(result.json.plan.selection.followed_recommendation, false);
    assert.equal(result.json.plan.selection.acknowledged_non_recommendation, true);
  });

  it('requires acknowledgement for a non-recommended selection', () => {
    const result = runSsf(['execution', 'plan', changeDir, '--mode', 'batch-inline',
      '--reason', 'operator wants a batch', '--wave', 'wave-1:serial:1.1', '--json'], process.cwd(), { acknowledgePlan: false });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /acknowledge/i);
  });

  it('rejects multiline and control-character reasons before mutating the plan or state', () => {
    const statePath = join(changeDir, '.spec-superflow.yaml');
    const planPath = join(changeDir, '.superpowers', 'sdd', 'execution-plan.json');
    const originalState = readFileSync(statePath, 'utf8');

    for (const reason of ['approved\nexecution_mode: inline', 'approved\u0001inline']) {
      const result = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', reason,
        '--wave', 'wave-1:parallel:1.1,1.2', '--json']);

      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /reason.*control|reason.*line/i);
      assert.equal(readFileSync(statePath, 'utf8'), originalState);
      assert.equal(existsSync(planPath), false);
    }
  });

  it('shows the persisted execution plan', () => {
    runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:parallel:1.1,1.2']);

    const result = runSsf(['execution', 'show', changeDir, '--json']);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.plan.mode, 'sdd');
    assert.equal(result.json.valid, true);
    assert.equal(result.json.current, true);
    assert.deepEqual(result.json.waves, [{
      id: 'wave-1',
      strategy: 'parallel',
      tasks: ['1.1', '1.2'],
      depends_on: [],
      eligible: true,
      retryable: false,
      receipt: null,
      blockers: [],
      repair: { status: 'not-needed', failure_count: 0, previous_head: null, previous_report: null, failures: [] },
    }]);
  });

  it('keeps an overlay-relative review report current across working directories', () => {
    const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:serial:1.1']);
    assert.equal(planned.exitCode, 0, planned.stderr);
    writeReviewReport('wave-1.md');
    const reviewCwd = mkdtempSync(join(tmpdir(), 'ssf-review-cwd-'));
    const showCwd = mkdtempSync(join(tmpdir(), 'ssf-show-cwd-'));

    try {
      const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
        '--base', gitRefs.base, '--head', gitRefs.head,
        '--report', '.superpowers/sdd/reviews/wave-1.md', '--verdict', 'pass'], reviewCwd);
      assert.equal(reviewed.exitCode, 0, reviewed.stderr);

      const shown = runSsf(['execution', 'show', changeDir, '--json'], showCwd);
      assert.equal(shown.exitCode, 0, shown.stderr);
      assert.equal(shown.json.current, true);
      assert.equal(shown.json.waves[0].receipt.status, 'pass');
    } finally {
      rmSync(reviewCwd, { recursive: true, force: true });
      rmSync(showCwd, { recursive: true, force: true });
    }
  });

  it('rejects review reports outside the change overlay', () => {
    const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:serial:1.1']);
    assert.equal(planned.exitCode, 0, planned.stderr);
    const outsideReport = join(changeDir, 'reports', 'wave-1.md');
    mkdirSync(join(changeDir, 'reports'), { recursive: true });
    writeFileSync(outsideReport, 'Review completed without blocking findings.\n');

    const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', outsideReport, '--verdict', 'pass']);

    assert.notEqual(reviewed.exitCode, 0);
    assert.match(reviewed.stderr, /overlay|review/i);
  });

  it('rejects a report reached through a nested review-directory symlink', { skip: !canCreateSymlink() }, () => {
    const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:serial:1.1']);
    assert.equal(planned.exitCode, 0, planned.stderr);
    const outsideDir = join(changeDir, 'reports');
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, 'escaped.md'), 'Review completed without blocking findings.\n');
    const reviewsDir = join(changeDir, '.superpowers', 'sdd', 'reviews');
    mkdirSync(reviewsDir, { recursive: true });
    symlinkSync(outsideDir, join(reviewsDir, 'linked'), 'dir');

    const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head,
      '--report', '.superpowers/sdd/reviews/linked/escaped.md', '--verdict', 'pass']);

    assert.notEqual(reviewed.exitCode, 0);
    assert.match(reviewed.stderr, /overlay|review/i);
  });

  it('rejects a report when the reviews overlay root is a symlink', { skip: !canCreateSymlink() }, () => {
    const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:serial:1.1']);
    assert.equal(planned.exitCode, 0, planned.stderr);
    const outsideReviewsDir = mkdtempSync(join(tmpdir(), 'ssf-external-reviews-'));
    const reviewsDir = join(changeDir, '.superpowers', 'sdd', 'reviews');

    try {
      rmSync(reviewsDir, { recursive: true, force: true });
      writeFileSync(join(outsideReviewsDir, 'wave-1.md'), 'Review completed without blocking findings.\n');
      symlinkSync(outsideReviewsDir, reviewsDir, 'dir');

      const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
        '--base', gitRefs.base, '--head', gitRefs.head,
        '--report', '.superpowers/sdd/reviews/wave-1.md', '--verdict', 'pass']);

      assert.notEqual(reviewed.exitCode, 0);
      assert.match(reviewed.stderr, /overlay|review|symbolic/i);
    } finally {
      rmSync(outsideReviewsDir, { recursive: true, force: true });
    }
  });

  it('rejects a receipt range containing a nonexistent Git commit', () => {
    const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:serial:1.1']);
    assert.equal(planned.exitCode, 0, planned.stderr);
    const forgedCommit = '0000000000000000000000000000000000000001';

    const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', forgedCommit, '--head', gitRefs.head, '--report', writeReviewReport('wave-1.md'), '--verdict', 'pass']);

    assert.notEqual(reviewed.exitCode, 0);
    assert.match(reviewed.stderr, /base|commit|Git/i);
  });

  it('rejects a receipt range whose base is not an ancestor of head', () => {
    const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:serial:1.1']);
    assert.equal(planned.exitCode, 0, planned.stderr);

    const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.head, '--head', gitRefs.divergent,
      '--report', writeReviewReport('wave-1.md'), '--verdict', 'pass']);

    assert.notEqual(reviewed.exitCode, 0);
    assert.match(reviewed.stderr, /ancestor|range|base/i);
  });

  it('treats a persisted pass receipt with a forged Git base as unusable', () => {
    const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:serial:1.1', '--wave', 'wave-2:serial:1.2:wave-1']);
    assert.equal(planned.exitCode, 0, planned.stderr);
    const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', writeReviewReport('wave-1.md'), '--verdict', 'pass']);
    assert.equal(reviewed.exitCode, 0, reviewed.stderr);

    const receiptPath = currentReceiptPath('wave-1');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    receipt.base = '0000000000000000000000000000000000000001';
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.waves[0].receipt, null);
    assert.deepEqual(shown.json.waves[1].blockers, ['wave-1']);
    assert.equal(shown.json.waves[1].eligible, false);
  });

  it('treats a persisted pass receipt with a non-ancestral Git range as unusable', () => {
    const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:serial:1.1', '--wave', 'wave-2:serial:1.2:wave-1']);
    assert.equal(planned.exitCode, 0, planned.stderr);
    const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', writeReviewReport('wave-1.md'), '--verdict', 'pass']);
    assert.equal(reviewed.exitCode, 0, reviewed.stderr);

    const receiptPath = currentReceiptPath('wave-1');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    receipt.base = gitRefs.head;
    receipt.head = gitRefs.divergent;
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.waves[0].receipt, null);
    assert.deepEqual(shown.json.waves[1].blockers, ['wave-1']);
    assert.equal(shown.json.waves[1].eligible, false);
  });

  it('does not show a pass receipt after its report evidence is deleted', () => {
    runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:serial:1.1']);
    const reportPath = writeReviewReport('wave-1.md');
    const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', reportPath, '--verdict', 'pass']);
    assert.equal(reviewed.exitCode, 0, reviewed.stderr);

    rmSync(reportPath);

    const shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.waves[0].receipt, null);
    assert.equal(shown.json.waves[0].eligible, true);
  });

  it('encodes wave dependencies and refuses review of a wave before its dependencies pass', () => {
    const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
      '--reason', 'full workflow default',
      '--wave', 'wave-1:parallel:1.1,1.2',
      '--wave', 'wave-2:serial:2.1:wave-1', '--json']);
    assert.equal(planned.exitCode, 0, planned.stderr);
    assert.deepEqual(planned.json.plan.waves[1].depends_on, ['wave-1']);

    const shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.waves[0].eligible, true);
    assert.equal(shown.json.waves[1].eligible, false);
    assert.deepEqual(shown.json.waves[1].blockers, ['wave-1']);

    const premature = runSsf(['execution', 'review', changeDir, '--wave', 'wave-2',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', 'reports/wave-2.md', '--verdict', 'pass']);
    assert.notEqual(premature.exitCode, 0);
    assert.match(premature.stderr, /wave-1.*pass|dependencies/i);
  });

  it('rejects a plan when state mode differs from the frozen plan mode', () => {
    runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:parallel:1.1,1.2']);
    const statePath = join(changeDir, '.spec-superflow.yaml');
    writeFileSync(statePath, readFileSync(statePath, 'utf8').replace('execution_mode: sdd', 'execution_mode: inline'));

    const result = runSsf(['execution', 'show', changeDir, '--json']);

    assert.notEqual(result.exitCode, 0);
    assert.equal(result.json.valid, false);
    assert.ok(result.json.failures.includes('execution plan mode does not match state'));
  });

  it('increments revision when a batch-inline plan is revised to SDD', () => {
    const initial = runSsf(['execution', 'plan', changeDir, '--mode', 'batch-inline', '--confirm', '--acknowledge-recommendation',
      '--reason', 'operator requested a batch', '--wave', 'wave-1:serial:1.1']);
    assert.equal(initial.exitCode, 0, initial.stderr);

    const revised = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd',
      '--reason', 'risk requires independent review', '--wave', 'wave-1:parallel:1.1,1.2', '--json']);

    assert.equal(revised.exitCode, 0, revised.stderr);
    assert.equal(revised.json.plan.revision, 2);
    assert.equal(runSsf(['state', 'get', changeDir, 'execution_plan_revision', '--json']).json.value, 2);
  });

  it('requires confirmation but not acknowledgement when revising to sdd', () => {
    const initial = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
      '--reason', 'parallel work needs review', '--wave', 'wave-1:parallel:1.1,1.2']);
    assert.equal(initial.exitCode, 0, initial.stderr);

    const recommended = runSsf(['execution', 'recommend', changeDir,
      '--wave', 'wave-1:serial:1.1']);
    assert.equal(recommended.exitCode, 0, recommended.stderr);

    const missingConfirm = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd',
      '--reason', 'retain SDD for the revised work', '--wave', 'wave-1:serial:1.1'], process.cwd(), {
      confirmPlan: false,
      prepareRecommendation: false,
    });
    assert.notEqual(missingConfirm.exitCode, 0);
    assert.match(missingConfirm.stderr, /confirm/i);

    // The revise path only permits sdd (a controlled upgrade), so it no longer
    // requires --acknowledge-recommendation even when the recommendation differs.
    const revised = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd', '--confirm',
      '--reason', 'retain SDD for the revised work', '--wave', 'wave-1:serial:1.1', '--json'], process.cwd(), {
      acknowledgePlan: false,
      prepareRecommendation: false,
    });
    assert.equal(revised.exitCode, 0, revised.stderr);
    assert.equal(revised.json.plan.selection.confirmed, true);
    assert.equal(revised.json.plan.selection.followed_recommendation, false);
  });

  it('requires a fresh recommendation after the prior plan before recording a revision', () => {
    const initial = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
      '--reason', 'parallel work needs review', '--wave', 'wave-1:parallel:1.1,1.2']);
    assert.equal(initial.exitCode, 0, initial.stderr);

    const result = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd', '--confirm',
      '--reason', 'reconfirm the same work as a new revision', '--wave', 'wave-1:parallel:1.1,1.2'], process.cwd(), {
      prepareRecommendation: false,
    });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /recommend/i);
  });

  it('invalidates receipts from the replaced plan revision', () => {
    const initial = runSsf(['execution', 'plan', changeDir, '--mode', 'batch-inline', '--confirm', '--acknowledge-recommendation',
      '--reason', 'operator requested a batch', '--wave', 'wave-1:serial:1.1']);
    assert.equal(initial.exitCode, 0, initial.stderr);
    const reportPath = writeReviewReport('wave-1.md');
    const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', reportPath, '--verdict', 'pass']);
    assert.equal(reviewed.exitCode, 0, reviewed.stderr);

    const revised = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd',
      '--reason', 'risk requires independent review', '--wave', 'wave-1:parallel:1.1,1.2', '--json']);
    assert.equal(revised.exitCode, 0, revised.stderr);

    const shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.current, true);
    assert.equal(shown.json.waves[0].receipt, null);
    assert.equal(shown.json.waves[0].eligible, true);
  });

  it('replans a current SDD plan with a new revision, renewed DP-4 state, and cleared receipts', () => {
    const initial = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
      '--reason', 'full workflow default', '--wave', 'wave-1:serial:1.1']);
    assert.equal(initial.exitCode, 0, initial.stderr);
    const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', writeReviewReport('wave-1.md'), '--verdict', 'pass']);
    assert.equal(reviewed.exitCode, 0, reviewed.stderr);

    const replanned = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd',
      '--reason', 'split independent work into a recovery wave',
      '--wave', 'wave-1:parallel:1.1,1.2', '--json']);

    assert.equal(replanned.exitCode, 0, replanned.stderr);
    assert.equal(replanned.json.plan.revision, 2);
    assert.equal(runSsf(['state', 'get', changeDir, 'execution_plan_revision', '--json']).json.value, 2);
    assert.match(runSsf(['state', 'get', changeDir, 'dp_4_result', '--json']).json.value, /plan revision 2/);
    const shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.current, true);
    assert.equal(shown.json.waves[0].receipt, null);
  });

  it('recovers a stale SDD plan by revising it to current artifacts and clearing old receipts', () => {
    const initial = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
      '--reason', 'full workflow default', '--wave', 'wave-1:serial:1.1']);
    assert.equal(initial.exitCode, 0, initial.stderr);
    const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', writeReviewReport('stale-wave-1.md'), '--verdict', 'pass']);
    assert.equal(reviewed.exitCode, 0, reviewed.stderr);
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Updated task\n- [ ] 1.2 Recovery task\n');

    const replanned = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd',
      '--reason', 'refresh the plan after task scope changed',
      '--wave', 'wave-1:parallel:1.1,1.2', '--json']);

    assert.equal(replanned.exitCode, 0, replanned.stderr);
    assert.equal(replanned.json.plan.revision, 2);
    const shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.current, true);
    assert.equal(shown.json.waves[0].receipt, null);
    assert.match(runSsf(['state', 'get', changeDir, 'dp_4_result', '--json']).json.value, /plan revision 2/);
  });

  it('makes a failed current wave retryable while blocking dependents until its replacement pass receipt', () => {
    const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
      '--reason', 'repair reviews before dependent work',
      '--wave', 'wave-1:serial:1.1',
      '--wave', 'wave-2:serial:1.2:wave-1']);
    assert.equal(planned.exitCode, 0, planned.stderr);

    const failed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', writeReviewReport('wave-1-fail.md'), '--verdict', 'fail']);
    assert.equal(failed.exitCode, 0, failed.stderr);

    let shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.waves[0].receipt.status, 'fail');
    assert.equal(shown.json.waves[0].repair.status, 'repairing');
    assert.equal(shown.json.waves[0].repair.failure_count, 1);
    assert.equal(shown.json.waves[0].retryable, true);
    assert.equal(shown.json.waves[0].eligible, true);
    assert.equal(shown.json.waves[1].eligible, false);
    assert.deepEqual(shown.json.waves[1].blockers, ['wave-1']);

    const replacement = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', writeReviewReport('wave-1-pass.md'), '--verdict', 'pass']);
    assert.equal(replacement.exitCode, 0, replacement.stderr);

    shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.waves[0].receipt.status, 'pass');
    assert.equal(shown.json.waves[0].repair.status, 'resolved');
    assert.equal(shown.json.waves[0].retryable, false);
    assert.equal(shown.json.waves[0].eligible, false);
    assert.equal(shown.json.waves[1].eligible, true);
  });

  it('shows a third unresolved repair as adjudication-required rather than dispatching another retry', () => {
    const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
      '--reason', 'three failed repairs require a controller decision',
      '--wave', 'wave-1:serial:1.1',
      '--wave', 'wave-2:serial:1.2:wave-1']);
    assert.equal(planned.exitCode, 0, planned.stderr);

    let base = gitRefs.base;
    let head = gitRefs.head;
    for (let failure = 1; failure <= 3; failure += 1) {
      const failed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
        '--base', base, '--head', head,
        '--report', writeReviewReport(`adjudication-${failure}.md`), '--verdict', 'fail']);
      assert.equal(failed.exitCode, 0, failed.stderr);
      base = head;
      head = createRepairCommit(`adjudication-${failure}`);
    }

    const shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.exitCode, 0, shown.stderr);
    assert.equal(shown.json.waves[0].repair.status, 'adjudication-required');
    assert.equal(shown.json.waves[0].repair.failure_count, 3);
    assert.equal(shown.json.waves[0].retryable, false);
    assert.equal(shown.json.waves[0].eligible, false);
    assert.equal(shown.json.waves[1].eligible, false);
    assert.deepEqual(shown.json.waves[1].blockers, ['wave-1']);
  });

  it('records a confirmed adjudication and exposes one active review authorization', () => {
    const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
      '--reason', 'adjudication recovery remains auditable', '--wave', 'wave-1:serial:1.1']);
    assert.equal(planned.exitCode, 0, planned.stderr);
    let base = gitRefs.base;
    let head = gitRefs.head;
    for (let failure = 1; failure <= 3; failure += 1) {
      const failed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
        '--base', base, '--head', head, '--report', writeReviewReport(`cli-adjudication-${failure}.md`),
        '--verdict', 'fail']);
      assert.equal(failed.exitCode, 0, failed.stderr);
      base = head;
      head = createRepairCommit(`cli-adjudication-${failure}`);
    }

    for (const args of [
      ['--decision', 'allow-review', '--reason', 'Human reviewed the failure chain.'],
      ['--decision', 'allow-review', '--confirm'],
      ['--decision', 'pass', '--confirm', '--reason', 'Invalid decision must not pass.'],
    ]) {
      const rejected = runSsf(['execution', 'adjudicate', changeDir, '--wave', 'wave-1', ...args]);
      assert.notEqual(rejected.exitCode, 0);
    }

    const result = runSsf(['execution', 'adjudicate', changeDir, '--wave', 'wave-1',
      '--decision', 'allow-review', '--confirm', '--reason', 'Human reviewed all failures and authorizes one focused review.', '--json']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.adjudication.status, 'authorized');
    assert.equal(result.json.adjudication.confirmed, true);
    assert.equal(result.json.adjudication.failure_count, 3);

    const shown = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(shown.json.waves[0].adjudication.active, true);
    assert.equal(shown.json.waves[0].adjudication.confirmed, true);
    assert.equal(shown.json.waves[0].retryable, true);
    assert.equal(shown.json.waves[0].eligible, true);

    const replay = runSsf(['execution', 'adjudicate', changeDir, '--wave', 'wave-1',
      '--decision', 'allow-review', '--confirm', '--reason', 'Replay must be rejected.']);
    assert.notEqual(replay.exitCode, 0);
    assert.match(replay.stderr, /active.*authorization/i);
  });

  it('keeps the Task 1 state revision aligned through plan, show, revise, and show', () => {
    writeChangeDirectory(changeDir, 'full', 2);
    const initial = runSsf(['execution', 'plan', changeDir, '--mode', 'batch-inline', '--confirm', '--acknowledge-recommendation',
      '--reason', 'operator requested a batch', '--wave', 'wave-1:serial:1.1', '--json']);
    assert.equal(initial.exitCode, 0, initial.stderr);
    assert.equal(initial.json.plan.revision, 2);

    const firstShow = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(firstShow.exitCode, 0, firstShow.stderr);
    assert.equal(firstShow.json.valid, true);
    assert.equal(runSsf(['state', 'get', changeDir, 'revision', '--json']).json.value, 2);

    const revised = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd',
      '--reason', 'risk requires independent review', '--wave', 'wave-1:parallel:1.1,1.2', '--json']);
    assert.equal(revised.exitCode, 0, revised.stderr);
    assert.equal(revised.json.plan.revision, 3);

    const secondShow = runSsf(['execution', 'show', changeDir, '--json']);
    assert.equal(secondShow.exitCode, 0, secondShow.stderr);
    assert.equal(secondShow.json.valid, true);
    assert.equal(runSsf(['state', 'get', changeDir, 'revision', '--json']).json.value, 3);
  });

  it('rejects an invalid review verdict without writing a receipt', () => {
    runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default',
      '--wave', 'wave-1:parallel:1.1,1.2']);

    const result = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', 'reports/wave-1.md', '--verdict', 'maybe', '--json']);

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /pass.*fail|verdict/i);
  });

  it('rejects a review without exactly one wave selector', () => {
    const result = runSsf(['execution', 'review', changeDir, '--base', gitRefs.base,
      '--head', gitRefs.head, '--report', 'reports/wave-1.md', '--verdict', 'pass']);

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /--wave is required/);
  });

  it('rejects malformed waves and SDD plan downgrades', () => {
    const malformed = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'bad wave', '--wave', 'missing-parts']);
    assert.notEqual(malformed.exitCode, 0);
    assert.match(malformed.stderr, /wave/i);

    runSsf(['execution', 'plan', changeDir, '--mode', 'sdd', '--reason', 'full workflow default', '--wave', 'wave-1:serial:1.1']);
    const invalidRevision = runSsf(['execution', 'revise', changeDir, '--mode', 'inline', '--reason', 'downgrade', '--wave', 'wave-1:serial:1.1']);
    assert.notEqual(invalidRevision.exitCode, 0);
    assert.match(invalidRevision.stderr, /sdd|downgrade|upgrade/i);
  });

  it('allows revise to sdd without acknowledge-recommendation even when recommendation differs', () => {
    // First create a batch-inline plan
    const initial = runSsf(['execution', 'plan', changeDir, '--mode', 'batch-inline', '--confirm', '--acknowledge-recommendation',
      '--reason', 'operator requested a batch', '--wave', 'wave-1:serial:1.1']);
    assert.equal(initial.exitCode, 0, initial.stderr);

    // Revise to sdd: the single serial task recommends inline (differs from sdd),
    // but the revise path no longer requires --acknowledge-recommendation.
    const revised = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd',
      '--reason', 'risk requires independent review', '--wave', 'wave-1:serial:1.1', '--json'], process.cwd(), {
      acknowledgePlan: false, // Do NOT auto-add --acknowledge-recommendation
    });

    assert.equal(revised.exitCode, 0, revised.stderr);
    assert.equal(revised.json.plan.mode, 'sdd');
    assert.equal(revised.json.plan.revision, 2);
    // The selection records an informed departure: --confirm plus the forced
    // sdd upgrade counts as the acknowledgement, not the (absent) flag.
    assert.equal(revised.json.plan.source, 'user-confirmed-revision');
    assert.equal(revised.json.plan.selection.confirmed, true);
    assert.equal(revised.json.plan.selection.followed_recommendation, false);
    assert.equal(revised.json.plan.selection.acknowledged_non_recommendation, true);
  });

  it('requires acknowledge-recommendation for non-recommended mode selection on plan', () => {
    // Try to select non-recommended mode without acknowledge
    const result = runSsf(['execution', 'plan', changeDir, '--mode', 'inline', '--confirm',
      '--reason', 'operator wants inline', '--wave', 'wave-1:parallel:1.1,1.2', '--json'], process.cwd(), {
      acknowledgePlan: false,
    });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /acknowledge/i);
  });

  // plan-resync R2：resync 子命令的 CLI 级拒绝路径与成功路径
  describe('ssf execution resync (plan-resync R2)', () => {
    const planPath = () => join(changeDir, '.superpowers', 'sdd', 'execution-plan.json');

    function createPlanSnapshot() {
      const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
        '--reason', 'full workflow default', '--wave', 'wave-1:serial:1.1']);
      assert.equal(planned.exitCode, 0, planned.stderr);
      return readFileSync(planPath(), 'utf8');
    }

    function makeStalePlan() {
      const before = createPlanSnapshot();
      // 非语义结构修正：修改 tasks.md 冻结内容，触发 artifacts_hash 变化 → plan stale
      writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 First task refined\n- [ ] 1.2 Second task\n');
      return before;
    }

    it('rejects resync without --confirm and writes nothing', () => {
      makeStalePlan();
      const before = readFileSync(planPath(), 'utf8');

      const result = runSsf(['execution', 'resync', changeDir,
        '--reason', 'format fix'], process.cwd(), { confirmPlan: false });

      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /confirm/i);
      assert.equal(readFileSync(planPath(), 'utf8'), before, 'missing --confirm must not write');
    });

    it('rejects resync when the plan is not stale and leaves the plan byte-identical', () => {
      const before = createPlanSnapshot();

      const result = runSsf(['execution', 'resync', changeDir, '--confirm',
        '--reason', 'nothing changed', '--json']);

      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /no need to resync|not stale|无需|不需要/is);
      assert.equal(readFileSync(planPath(), 'utf8'), before, 'no-op rejection must not write');
    });

    it('rejects resync while a wave has a fail receipt, naming the wave id and writing nothing', () => {
      const before = createPlanSnapshot();
      const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
        '--base', gitRefs.base, '--head', gitRefs.head, '--report', writeReviewReport('resync-cli-fail.md'), '--verdict', 'fail']);
      assert.equal(reviewed.exitCode, 0, reviewed.stderr);
      // plan 保持与录音 receipt 时一致的 artifacts_hash → 不 stale；
      // 但 fail receipt 存在本身就是独立拒绝条件，无需 stale 前置
      writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 First task refined\n- [ ] 1.2 Second task\n');
      const reviewsBefore = readdirSync(join(changeDir, '.superpowers', 'sdd', 'reviews')).sort();

      const result = runSsf(['execution', 'resync', changeDir, '--confirm',
        '--reason', 'attempted while repair chain open', '--json']);

      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /wave-1/);
      assert.equal(readFileSync(planPath(), 'utf8'), before, 'fail-receipt rejection must not write the plan');
      assert.deepEqual(
        readdirSync(join(changeDir, '.superpowers', 'sdd', 'reviews')).sort(),
        reviewsBefore,
        'fail-receipt rejection must not modify the root receipt store',
      );
    });

    it('rejects resync without --reason with a message explaining its purpose', () => {
      makeStalePlan();
      const before = readFileSync(planPath(), 'utf8');

      const result = runSsf(['execution', 'resync', changeDir, '--confirm']);

      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /--reason/i);
      assert.match(result.stderr, /non-semantic planning-document correction/i,
        `--reason error must explain its purpose, got: ${result.stderr}`);
      assert.equal(readFileSync(planPath(), 'utf8'), before, 'missing --reason must not write');
    });

    it('resyncs a stale plan via the CLI and keeps validatePlan passing', () => {
      makeStalePlan();

      const result = runSsf(['execution', 'resync', changeDir, '--confirm',
        '--reason', 'format fix', '--json']);

      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.json.ok, true);
      const shown = runSsf(['execution', 'show', changeDir, '--json']);
      assert.equal(shown.exitCode, 0, shown.stderr);
      assert.equal(shown.json.valid, true, 'plan must be current after CLI resync');
      assert.equal(shown.json.current, true);
    });
  });
});

describe('ssf execution review — cwd 越界 WARN（worktree-lifecycle R5）', () => {
  it('change 存在隔离 worktree 且 cwd=主仓库（worktree 外）时输出含 worktree 路径的 WARN，命令正常完成', () => {
    const tmpBase = mkdtempSync(join(tmpdir(), 'ssf-review-warn-outside-'));
    tempDirs.push(tmpBase);
    const main = join(tmpBase, 'main');
    makeRepo(main);
    const name = 'warn-outside';
    const changePath = join(main, 'changes', name);
    mkdirSync(changePath, { recursive: true });
    writeChangeDirectory(changePath);
    const gitBase = runGit(main, ['rev-parse', 'HEAD']);
    createReviewPlan(changePath);

    const r = spawnSync(process.execPath, [ENSURE, changePath, name], {
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file' },
    });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const worktree = join(tmpBase, `${basename(main)}-${name}`);
    assert.equal(existsSync(worktree), true, `worktree must exist at ${worktree}`);
    // 断言用规范化路径必须在 review 前捕获（防 worktree 被清理后 realpath
    // 抛 ENOENT）。CI Windows 的 TEMP 是 8.3 短名（RUNNER~1），生产代码经
    // native realpath 规范化输出，断言须用同形式。
    const worktreeReal = realpathSync.native(worktree);
    commitFileInWorktree(worktree, 'feature.txt', 'branch work\n');
    const head = runGit(main, ['rev-parse', name]);
    const reportPath = writeReviewReportIn(changePath, 'wave-1.md');

    const reviewed = runReviewCli(changePath, [
      '--wave', 'wave-1', '--base', gitBase, '--head', head,
      '--report', reportPath, '--verdict', 'pass',
    ], main);

    assert.equal(reviewed.status, 0, reviewed.all);
    assert.match(reviewed.all, /WARN/);
    assert.ok(reviewed.stdout.includes(worktreeReal), `WARN must contain worktree path ${worktreeReal}`);
    assert.match(reviewed.all, /worktree 内路径/);
    assert.match(reviewed.stdout, /recorded: pass/);
  });

  it('cwd 位于 change 的 worktree 内时不输出 WARN', () => {
    const tmpBase = mkdtempSync(join(tmpdir(), 'ssf-review-warn-inside-'));
    tempDirs.push(tmpBase);
    const main = join(tmpBase, 'main');
    makeRepo(main);
    const name = 'warn-inside';
    const changePath = join(main, 'changes', name);
    mkdirSync(changePath, { recursive: true });
    writeChangeDirectory(changePath);
    const gitBase = runGit(main, ['rev-parse', 'HEAD']);
    createReviewPlan(changePath);

    const r = spawnSync(process.execPath, [ENSURE, changePath, name], {
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file' },
    });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const worktree = join(tmpBase, `${basename(main)}-${name}`);
    assert.equal(existsSync(worktree), true, `worktree must exist at ${worktree}`);
    commitFileInWorktree(worktree, 'feature.txt', 'branch work\n');
    const head = runGit(main, ['rev-parse', name]);
    const reportPath = writeReviewReportIn(changePath, 'wave-1.md');

    const reviewed = runReviewCli(changePath, [
      '--wave', 'wave-1', '--base', gitBase, '--head', head,
      '--report', reportPath, '--verdict', 'pass',
    ], worktree);

    assert.equal(reviewed.status, 0, reviewed.all);
    assert.doesNotMatch(reviewed.all, /WARN/);
    assert.match(reviewed.stdout, /recorded: pass/);
  });

  it('无隔离 worktree 的 change 不输出 WARN', () => {
    const tmpBase = mkdtempSync(join(tmpdir(), 'ssf-review-warn-none-'));
    tempDirs.push(tmpBase);
    const main = join(tmpBase, 'main');
    makeRepo(main);
    const name = 'warn-none';
    const changePath = join(main, 'changes', name);
    mkdirSync(changePath, { recursive: true });
    writeChangeDirectory(changePath);
    // 在默认分支上创建一个提交并建立非 protected 分支，满足 R4 分支校验
    writeFileSync(join(main, 'feature.txt'), 'feature\n');
    runGit(main, ['add', '-A']);
    runGit(main, ['commit', '-q', '-m', 'feature commit']);
    const gitBase = runGit(main, ['rev-parse', 'HEAD~1']);
    const head = runGit(main, ['rev-parse', 'HEAD']);
    runGit(main, ['branch', 'feature', head]);
    createReviewPlan(changePath);
    const reportPath = writeReviewReportIn(changePath, 'wave-1.md');

    const reviewed = runReviewCli(changePath, [
      '--wave', 'wave-1', '--base', gitBase, '--head', head,
      '--report', reportPath, '--verdict', 'pass',
    ], main);

    assert.equal(reviewed.status, 0, reviewed.all);
    assert.doesNotMatch(reviewed.all, /WARN/);
    assert.match(reviewed.stdout, /recorded: pass/);
  });
});
