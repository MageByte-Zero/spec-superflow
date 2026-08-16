import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getPlanScopedPaths } from '../../scripts/lib/sdd-overlay.mjs';
import { run as runExecution } from '../../scripts/lib/cmd-execution.mjs';
import { readState, writeState, rebuildState } from '../../scripts/lib/state-loader.mjs';
import { computeArtifactsHash, computeContractHash } from '../../scripts/lib/hash.mjs';
import { createGitSeedFixture } from '../helpers/git-seed-fixture.mjs';

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

function rootReceiptPath(waveId) {
  return join(rootReviewsPath(), `${Buffer.from(waveId, 'utf8').toString('base64url')}.json`);
}

function rootReviewsPath() {
  return join(changeDir, '.superpowers', 'sdd', 'reviews');
}

function reportHash(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function snapshotTree(path) {
  if (!existsSync(path)) return { exists: false };
  const metadata = statSync(path);
  if (metadata.isDirectory()) {
    return {
      exists: true,
      type: 'directory',
      mtimeMs: metadata.mtimeMs,
      children: readdirSync(path).sort().map(name => [name, snapshotTree(join(path, name))]),
    };
  }
  return { exists: true, type: 'file', mtimeMs: metadata.mtimeMs, bytes: readFileSync(path) };
}

function freezeTreeMtime(path, at = new Date('2000-01-01T00:00:00.000Z')) {
  if (!existsSync(path)) return;
  const metadata = statSync(path);
  if (metadata.isDirectory()) {
    for (const name of readdirSync(path)) freezeTreeMtime(join(path, name), at);
  }
  utimesSync(path, at, at);
}

function immutableEvidenceSnapshots(plan) {
  const paths = getPlanScopedPaths(changeDir, plan);
  return {
    scopedReview: snapshotTree(join(paths.reviews, `${Buffer.from('wave-1', 'utf8').toString('base64url')}.json`)),
    repairState: snapshotTree(join(paths.repairState, `${Buffer.from('wave-1', 'utf8').toString('base64url')}.json`)),
    workspace: snapshotTree(paths.workspace),
  };
}

function assertRootMatchesCurrentProjection(root, scopedReceipt, currentReportHash) {
  for (const field of ['status', 'base', 'head', 'report', 'plan_hash', 'plan_revision']) {
    assert.equal(root[field], scopedReceipt[field], `root ${field} must retain the current scoped identity`);
  }
  assert.equal(root.report_sha256, currentReportHash);
  assert.notEqual(root.report_sha256, scopedReceipt.report_sha256);
}

function prepareActiveProjectionRepairFixture() {
  const planned = runSsf(['execution', 'plan', changeDir, '--mode', 'sdd',
    '--reason', 'root projection repair requires immutable evidence', '--wave', 'wave-1:serial:1.1']);
  assert.equal(planned.exitCode, 0, planned.stderr);
  const reportPath = writeReviewReport('active-projection.md', 'Scoped PASS report before root repair.\n');
  const reviewed = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
    '--base', gitRefs.base, '--head', gitRefs.head, '--report', reportPath, '--verdict', 'pass']);
  assert.equal(reviewed.exitCode, 0, reviewed.stderr);

  const plan = JSON.parse(readFileSync(join(changeDir, '.superpowers', 'sdd', 'execution-plan.json'), 'utf8'));
  const paths = getPlanScopedPaths(changeDir, plan);
  const scopedReceipt = JSON.parse(readFileSync(currentReceiptPath('wave-1'), 'utf8'));
  writeFileSync(reportPath, 'Current report content used to repair the root projection.\n');
  const currentReportHash = reportHash(reportPath);
  mkdirSync(paths.workspace, { recursive: true });
  writeFileSync(join(paths.workspace, 'task-brief.md'), 'immutable workspace evidence\n');
  mkdirSync(paths.repairState, { recursive: true });
  writeFileSync(join(paths.repairState, `${Buffer.from('wave-1', 'utf8').toString('base64url')}.json`), '{"preserve":"repair-state"}\n');
  freezeTreeMtime(paths.reviews);
  freezeTreeMtime(paths.repairState);
  freezeTreeMtime(paths.workspace);
  freezeTreeMtime(rootReceiptPath('wave-1'));

  return { plan, paths, reportPath, scopedReceipt, currentReportHash };
}

function rejectActiveProjectionRepair(testCase) {
  const fixture = prepareActiveProjectionRepairFixture();
  const commandInputs = testCase.mutate(fixture) ?? {};
  const rootReviewsBefore = snapshotTree(rootReviewsPath());
  const immutableBefore = immutableEvidenceSnapshots(fixture.plan);
  const result = runSsf(['execution', 'review', changeDir, '--wave', testCase.wave ?? 'wave-1',
    '--base', commandInputs.base ?? gitRefs.base, '--head', commandInputs.head ?? gitRefs.head,
    '--report', commandInputs.report ?? fixture.reportPath, '--verdict', testCase.verdict ?? 'pass',
    '--repair-active-projection', '--json']);

  assert.notEqual(result.exitCode, 0, testCase.name);
  assert.equal(result.json, null, `${testCase.name} must not emit a success JSON receipt`);
  assert.match(result.stderr, testCase.expected, testCase.name);
  assert.deepEqual(snapshotTree(rootReviewsPath()), rootReviewsBefore, `${testCase.name} root reviews write`);
  assert.deepEqual(immutableEvidenceSnapshots(fixture.plan), immutableBefore, `${testCase.name} scoped write`);
}

function createRepairCommit(label) {
  const marker = join(changeDir, `repair-${label}.txt`);
  writeFileSync(marker, `${label}\n`);
  runGit(changeDir, ['add', marker]);
  runGit(changeDir, ['commit', '--quiet', '--message', `repair ${label}`]);
  return runGit(changeDir, ['rev-parse', 'HEAD']);
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
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
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

  it('rejects a report reached through a nested review-directory symlink', () => {
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

  it('rejects a report when the reviews overlay root is a symlink', () => {
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

    const receiptPath = rootReceiptPath('wave-1');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    receipt.base = '0000000000000000000000000000000000000001';
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    rmSync(currentReceiptPath('wave-1'));

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

    const receiptPath = rootReceiptPath('wave-1');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    receipt.base = gitRefs.head;
    receipt.head = gitRefs.divergent;
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    rmSync(currentReceiptPath('wave-1'));

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

  it('requires confirmation and acknowledgement when a revision differs from its recommendation', () => {
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

    const missingAcknowledgement = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd', '--confirm',
      '--reason', 'retain SDD for the revised work', '--wave', 'wave-1:serial:1.1'], process.cwd(), {
      acknowledgePlan: false,
      prepareRecommendation: false,
    });
    assert.notEqual(missingAcknowledgement.exitCode, 0);
    assert.match(missingAcknowledgement.stderr, /acknowledge/i);

    const revised = runSsf(['execution', 'revise', changeDir, '--mode', 'sdd', '--confirm',
      '--acknowledge-recommendation', '--reason', 'retain SDD for the revised work',
      '--wave', 'wave-1:serial:1.1', '--json'], process.cwd(), { prepareRecommendation: false });
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

  it('repairs a missing root active projection with JSON output while leaving scoped evidence byte-and-mtime immutable', () => {
    // Mutation caught: route repair through recordReview(), which rewrites scoped receipt/repair-state or clears workspace.
    const { plan, paths, reportPath, scopedReceipt, currentReportHash } = prepareActiveProjectionRepairFixture();
    const before = immutableEvidenceSnapshots(plan);
    rmSync(rootReceiptPath('wave-1'));

    const result = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', reportPath, '--verdict', 'pass',
      '--repair-active-projection', '--json']);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Object.keys(result.json).sort(), ['changed', 'mode', 'ok', 'receipt', 'wave']);
    assert.equal(result.json.mode, 'active-projection-repair');
    assert.equal(result.json.changed, true);
    const rootReceipt = JSON.parse(readFileSync(rootReceiptPath('wave-1'), 'utf8'));
    assertRootMatchesCurrentProjection(rootReceipt, scopedReceipt, currentReportHash);
    assert.deepEqual(result.json.receipt, rootReceipt);
    assert.deepEqual(immutableEvidenceSnapshots(plan), before);
    assert.equal(snapshotTree(paths.workspace).children[0][0], 'task-brief.md');
  });

  it('replaces a stale root projection but changes no plan-scoped evidence', () => {
    // Mutation caught: accept a stale root receipt as current or overwrite the current scoped snapshot while repairing it.
    const { plan, reportPath, scopedReceipt, currentReportHash } = prepareActiveProjectionRepairFixture();
    const before = immutableEvidenceSnapshots(plan);
    assert.notEqual(JSON.parse(readFileSync(rootReceiptPath('wave-1'), 'utf8')).report_sha256, currentReportHash);

    const result = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', reportPath, '--verdict', 'pass',
      '--repair-active-projection', '--json']);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.changed, true);
    const rootReceipt = JSON.parse(readFileSync(rootReceiptPath('wave-1'), 'utf8'));
    assertRootMatchesCurrentProjection(rootReceipt, scopedReceipt, currentReportHash);
    assert.deepEqual(result.json.receipt, rootReceipt);
    assert.deepEqual(immutableEvidenceSnapshots(plan), before);
  });

  it('reports a current root repair as JSON no-op without changing root or immutable evidence mtimes', () => {
    // Mutation caught: always rewrite the root receipt even when it already equals the current scoped PASS snapshot.
    const { plan, reportPath, scopedReceipt, currentReportHash } = prepareActiveProjectionRepairFixture();
    writeFileSync(rootReceiptPath('wave-1'), `${JSON.stringify({ ...scopedReceipt, report_sha256: currentReportHash, recorded_at: '2000-01-01T00:00:00.000Z' }, null, 2)}\n`);
    freezeTreeMtime(rootReceiptPath('wave-1'));
    const rootReviewsBefore = snapshotTree(rootReviewsPath());
    const immutableBefore = immutableEvidenceSnapshots(plan);

    const result = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', reportPath, '--verdict', 'pass',
      '--repair-active-projection', '--json']);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.changed, false);
    assert.deepEqual(result.json.receipt, JSON.parse(readFileSync(rootReceiptPath('wave-1'), 'utf8')));
    assert.deepEqual(snapshotTree(rootReviewsPath()), rootReviewsBefore);
    assert.deepEqual(immutableEvidenceSnapshots(plan), immutableBefore);
  });

  it('rebuilds a matching root projection when recorded_at is missing', () => {
    // Mutation caught: treat matching evidence fields as a no-op even when the returned receipt is incomplete.
    const { plan, reportPath, scopedReceipt, currentReportHash } = prepareActiveProjectionRepairFixture();
    const incompleteReceipt = { ...scopedReceipt, report_sha256: currentReportHash };
    delete incompleteReceipt.recorded_at;
    writeFileSync(rootReceiptPath('wave-1'), `${JSON.stringify(incompleteReceipt, null, 2)}\n`);
    const immutableBefore = immutableEvidenceSnapshots(plan);

    const result = runSsf(['execution', 'review', changeDir, '--wave', 'wave-1',
      '--base', gitRefs.base, '--head', gitRefs.head, '--report', reportPath, '--verdict', 'pass',
      '--repair-active-projection', '--json']);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.json.changed, true);
    assert.equal(typeof result.json.receipt.recorded_at, 'string');
    assert.notEqual(result.json.receipt.recorded_at.trim(), '');
    assertRootMatchesCurrentProjection(result.json.receipt, scopedReceipt, currentReportHash);
    assert.deepEqual(result.json.receipt, JSON.parse(readFileSync(rootReceiptPath('wave-1'), 'utf8')));
    assert.deepEqual(immutableEvidenceSnapshots(plan), immutableBefore);
  });

  it('rejects a missing scoped repair snapshot without successful JSON or writes', () => {
    // Mutation caught: create root projection before checking that scoped evidence exists.
    rejectActiveProjectionRepair({
      name: 'missing scoped receipt',
      mutate: ({ paths }) => rmSync(join(paths.reviews, `${Buffer.from('wave-1', 'utf8').toString('base64url')}.json`)),
      expected: /scoped.*(missing|receipt)|current.*pass/i,
    });
  });

  it('rejects a malformed scoped repair snapshot without successful JSON or writes', () => {
    // Mutation caught: parse malformed scoped evidence after changing root state.
    rejectActiveProjectionRepair({
      name: 'malformed scoped receipt',
      mutate: ({ paths }) => writeFileSync(join(paths.reviews, `${Buffer.from('wave-1', 'utf8').toString('base64url')}.json`), '{ malformed'),
      expected: /scoped.*(invalid|parse)|current.*pass/i,
    });
  });

  it('rejects a wrong-plan scoped repair snapshot without successful JSON or writes', () => {
    // Mutation caught: accept a receipt belonging to another plan identity.
    rejectActiveProjectionRepair({
      name: 'wrong-plan scoped receipt',
      mutate: ({ paths }) => {
        const path = join(paths.reviews, `${Buffer.from('wave-1', 'utf8').toString('base64url')}.json`);
        writeFileSync(path, `${JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), plan_hash: `sha256:${'f'.repeat(64)}` }, null, 2)}\n`);
      },
      expected: /plan.*(identity|hash)|scoped.*plan/i,
    });
  });

  it('rejects a non-PASS scoped repair snapshot without successful JSON or writes', () => {
    // Mutation caught: promote a failed scoped receipt to an active PASS root projection.
    rejectActiveProjectionRepair({
      name: 'non-PASS scoped receipt',
      mutate: ({ paths }) => {
        const path = join(paths.reviews, `${Buffer.from('wave-1', 'utf8').toString('base64url')}.json`);
        writeFileSync(path, `${JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), status: 'fail' }, null, 2)}\n`);
      },
      expected: /scoped.*pass|pass.*scoped/i,
    });
  });

  it('rejects a non-PASS repair request without successful JSON or writes', () => {
    // Mutation caught: allow a FAIL repair request to create an active projection.
    rejectActiveProjectionRepair({
      name: 'non-PASS repair request',
      mutate: () => {},
      verdict: 'fail',
      expected: /repair request.*pass|repair.*only.*pass/i,
    });
  });

  it('rejects a mismatched scoped repair snapshot without successful JSON or writes', () => {
    // Mutation caught: repair a root from a scoped receipt whose range differs from CLI input.
    rejectActiveProjectionRepair({
      name: 'mismatched scoped snapshot',
      mutate: ({ paths }) => {
        const path = join(paths.reviews, `${Buffer.from('wave-1', 'utf8').toString('base64url')}.json`);
        writeFileSync(path, `${JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), head: gitRefs.base }, null, 2)}\n`);
      },
      expected: /scoped.*(match|range|snapshot)|current.*pass/i,
    });
  });

  it('rejects an unknown repair wave without successful JSON or writes', () => {
    // Mutation caught: write a new root reviews/<unknown-wave>.json receipt before rejecting the wave.
    rejectActiveProjectionRepair({
      name: 'unknown wave',
      wave: 'unknown-wave',
      mutate: () => {},
      expected: /unknown wave/i,
    });
  });

  it('rejects a missing repair report without successful JSON or writes', () => {
    // Mutation caught: defer report existence validation until after writing the root projection.
    rejectActiveProjectionRepair({
      name: 'missing repair report',
      mutate: ({ reportPath }) => rmSync(reportPath),
      expected: /report.*(regular|missing|exist|cannot be read)|enoent/i,
    });
  });

  it('rejects an empty repair report without successful JSON or writes', () => {
    // Mutation caught: accept an empty report as current review evidence.
    rejectActiveProjectionRepair({
      name: 'empty repair report',
      mutate: ({ reportPath }) => writeFileSync(reportPath, ''),
      expected: /report.*(empty|non-empty)/i,
    });
  });

  it('rejects a repair report outside the review overlay without successful JSON or writes', () => {
    // Mutation caught: omit the review-overlay containment check on the repair branch.
    rejectActiveProjectionRepair({
      name: 'outside repair report',
      mutate: () => {
        const report = join(changeDir, 'outside-active-projection.md');
        writeFileSync(report, 'Outside report must not authorize active projection repair.\n');
        const scopedPath = currentReceiptPath('wave-1');
        const scopedReceipt = JSON.parse(readFileSync(scopedPath, 'utf8'));
        writeFileSync(scopedPath, `${JSON.stringify({
          ...scopedReceipt,
          report: 'outside-active-projection.md',
          report_sha256: reportHash(report),
        }, null, 2)}\n`);
        return { report };
      },
      expected: /resolve inside.*review overlay/i,
    });
  });

  it('rejects a repair report reached through a symlink without successful JSON or writes', () => {
    // Mutation caught: validate only the lexical report path and skip physical containment.
    rejectActiveProjectionRepair({
      name: 'symlink repair report',
      mutate: () => {
        const outsideDir = join(changeDir, 'outside-repair-reports');
        mkdirSync(outsideDir, { recursive: true });
        writeFileSync(join(outsideDir, 'escaped.md'), 'Symlinked report must not authorize repair.\n');
        const linkedDir = join(rootReviewsPath(), 'linked-repair');
        symlinkSync(outsideDir, linkedDir, 'dir');
        const report = join(linkedDir, 'escaped.md');
        const scopedPath = currentReceiptPath('wave-1');
        const scopedReceipt = JSON.parse(readFileSync(scopedPath, 'utf8'));
        writeFileSync(scopedPath, `${JSON.stringify({
          ...scopedReceipt,
          report: 'outside-repair-reports/escaped.md',
          report_sha256: reportHash(report),
        }, null, 2)}\n`);
        return { report };
      },
      expected: /resolve inside.*review overlay/i,
    });
  });

  it('rejects a repair range containing a nonexistent commit without successful JSON or writes', () => {
    // Mutation caught: compare the requested range to scoped text before resolving both Git commits.
    rejectActiveProjectionRepair({
      name: 'nonexistent repair base',
      mutate: () => ({ base: '0000000000000000000000000000000000000001' }),
      expected: /base|commit|git/i,
    });
  });

  it('rejects a non-ancestor repair range without successful JSON or writes', () => {
    // Mutation caught: resolve commits without enforcing that base is an ancestor of head.
    rejectActiveProjectionRepair({
      name: 'non-ancestor repair range',
      mutate: () => ({ base: gitRefs.head, head: gitRefs.divergent }),
      expected: /ancestor|range|git/i,
    });
  });

  it('preserves a current invalid FAIL blocker instead of repairing over it', () => {
    // Mutation caught: fall back to scoped PASS and overwrite current failed evidence during repair.
    rejectActiveProjectionRepair({
      name: 'current invalid FAIL blocker',
      mutate: () => {
        const path = rootReceiptPath('wave-1');
        const receipt = JSON.parse(readFileSync(path, 'utf8'));
        writeFileSync(path, `${JSON.stringify({ ...receipt, status: 'fail' }, null, 2)}\n`);
      },
      expected: /current fail|fail active|cannot.*repair/i,
    });
  });
});
