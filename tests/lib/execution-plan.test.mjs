import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createGitRangeValidator, createPlan as createRawPlan, describeWaves, readCurrentReview, readPlan,
  recordReview, resyncPlan, validatePlan, writePlan,
} from '../../scripts/lib/execution-plan.mjs';
import { createRecommendationReceipt, recommendExecutionModes, validateRecommendationReceiptStructure } from '../../scripts/lib/execution-recommendation.mjs';
import { readState } from '../../scripts/lib/state-loader.mjs';
import { getCheckpoint, getPlanScopedPaths, listCheckpoints, saveCheckpoint } from '../../scripts/lib/sdd-overlay.mjs';
import * as sddOverlayModule from '../../scripts/lib/sdd-overlay.mjs';
import { createGitSeedFixture } from '../helpers/git-seed-fixture.mjs';
import { canCreateSymlink } from '../helpers/symlink-support.mjs';
import { computeArtifactsHash } from '../../scripts/lib/hash.mjs';
import { hashReceipt, readRecommendationReceipt, writeRecommendationReceipt } from '../../scripts/lib/execution-recommendation.mjs';

let changeDir;
let gitRefs;
let fixture;

function writeExecutionPlanChange(directory) {
  writeFileSync(join(directory, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 First task\n- [ ] 1.2 Second task\n');
  writeFileSync(join(directory, 'execution-contract.md'), '# Execution Contract\n\nCurrent contract.\n');
  writeFileSync(join(directory, '.spec-superflow.yaml'), 'state: approved-for-build\nworkflow: full\nrevision: 2\n');
}

before(() => {
  fixture = createGitSeedFixture({
    setup: writeExecutionPlanChange,
    initialCommitMessage: 'initial execution plan change',
    secondCommit: {
      path: 'git-range-marker.txt',
      content: 'second commit\n',
      message: 'second execution plan change',
    },
    prefix: 'execution-plan-seed-',
    copyPrefix: 'execution-plan-',
  });
});

beforeEach(() => {
  changeDir = fixture.createCopy();
  gitRefs = { base: fixture.base, head: fixture.head };
  // R4: head 须被至少一个非 protected 分支包含。seed 默认分支为 master
  // （protected），既有 review 用例直接使用该分支上的 head；建立一个指向
  // head 的非 protected 隔离分支，使分支校验放行，保持既有行为不变。
  runGit(changeDir, ['branch', 'test-isolation', fixture.head]);
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
});

after(() => {
  fixture.dispose();
});

function writeReviewReport(name, content = 'Review completed without blocking findings.\n') {
  const reportsDir = join(changeDir, '.superpowers', 'sdd', 'reviews');
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, name);
  writeFileSync(reportPath, content);
  return reportPath;
}

function runGit(directory, args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
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

// 从 base 检出新分支并提交一个文件，返回该分支上的新 head。
function commitOnNewBranch(branch, label) {
  runGit(changeDir, ['checkout', '--quiet', '-b', branch, gitRefs.base]);
  const marker = join(changeDir, `iso-${label}.txt`);
  writeFileSync(marker, `${label}\n`);
  runGit(changeDir, ['add', marker]);
  runGit(changeDir, ['commit', '--quiet', '--message', `isolated ${label}`]);
  return runGit(changeDir, ['rev-parse', 'HEAD']);
}

function containingBranches(commit) {
  return runGit(changeDir, ['branch', '--contains', commit, '--format=%(refname:short)'])
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function createPlan(directory, input) {
  const receipt = input.recommendationReceipt ?? createRecommendationReceipt(directory, input.waves);
  const recommendation = input.recommendation ?? receipt.recommendation;
  const followedRecommendation = input.mode === recommendation.recommendation.mode;
  return createRawPlan(directory, {
    ...input,
    source: input.source === 'default' ? 'user-confirmed' : input.source,
    recommendation,
    recommendationReceipt: receipt,
    selection: input.selection ?? {
      confirmed: true,
      followed_recommendation: followedRecommendation,
      acknowledged_non_recommendation: !followedRecommendation,
    },
  });
}

describe('execution plan data contract', () => {
  it('reuses one immutable Git review range but re-resolves symbolic revisions', () => {
    const base = 'a'.repeat(40);
    const head = 'b'.repeat(40);
    const calls = [];
    const validator = createGitRangeValidator((args) => {
      calls.push(args);
      if (args[2] === 'rev-parse' && args[3] === '--show-toplevel') return '/repo\n';
      if (args[2] === 'rev-parse' && args[3] === '--verify') {
        const revision = args[4].replace(/\^\{commit\}$/, '');
        return `${revision === 'HEAD' ? base : revision}\n`;
      }
      if (args[2] === 'merge-base' && args[3] === '--is-ancestor') return '';
      throw new Error(`Unexpected Git command: ${args.join(' ')}`);
    });

    assert.deepEqual(validator.validate('/change', base, head), { base, head });
    assert.equal(calls.length, 4, 'the first immutable range resolves root, two commits, and ancestry');

    assert.deepEqual(validator.validate('/change', base, head), { base, head });
    assert.equal(calls.length, 4, 'the same immutable range must not relaunch Git');

    assert.deepEqual(validator.validate('/change', 'HEAD', head), { base, head });
    assert.equal(calls.length, 8, 'symbolic revisions must be resolved and validated again');
  });

  it('reuses an immutable non-ancestor result without treating it as valid', () => {
    const base = 'c'.repeat(40);
    const head = 'd'.repeat(40);
    const calls = [];
    const validator = createGitRangeValidator((args) => {
      calls.push(args);
      if (args[2] === 'rev-parse' && args[3] === '--show-toplevel') return '/repo\n';
      if (args[2] === 'rev-parse' && args[3] === '--verify') return `${args[4].replace(/\^\{commit\}$/, '')}\n`;
      if (args[2] === 'merge-base' && args[3] === '--is-ancestor') throw new Error('not an ancestor');
      throw new Error(`Unexpected Git command: ${args.join(' ')}`);
    });

    assert.throws(() => validator.validate('/change', base, head), /ancestor/i);
    assert.equal(calls.length, 4);
    assert.throws(() => validator.validate('/change', base, head), /ancestor/i);
    assert.equal(calls.length, 4, 'the same immutable failing range must not relaunch Git');
  });

  it('recommends inline for one small sequential task', () => {
    const result = recommendExecutionModes({
      workflow: 'full',
      taskCount: 1,
      inlineThreshold: 3,
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });

    assert.deepEqual(result.available_modes, ['inline', 'batch-inline', 'sdd']);
    assert.equal(result.recommendation.mode, 'inline');
    assert.match(result.recommendation.reasons.join('\n'), /single sequential task/i);
  });

  it('recommends batch-inline for a bounded sequential batch', () => {
    const result = recommendExecutionModes({
      workflow: 'hotfix',
      taskCount: 3,
      inlineThreshold: 3,
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1', '1.2', '1.3'], depends_on: [] }],
    });

    assert.equal(result.recommendation.mode, 'batch-inline');
    assert.match(result.recommendation.reasons.join('\n'), /within.*threshold/i);
  });

  it('recommends SDD for independent parallel work', () => {
    const result = recommendExecutionModes({
      workflow: 'full',
      taskCount: 2,
      inlineThreshold: 3,
      waves: [{ id: 'foundation', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] }],
    });

    assert.equal(result.recommendation.mode, 'sdd');
    assert.match(result.recommendation.reasons.join('\n'), /parallel/i);
  });

  it('limits tweak recommendations to direct inline execution', () => {
    const result = recommendExecutionModes({ workflow: 'tweak', taskCount: 2, inlineThreshold: 3, waves: [] });

    assert.deepEqual(result.available_modes, ['inline']);
    assert.equal(result.recommendation.mode, 'inline');
  });

  it('creates a current SDD plan with an auditable parallel wave', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'full workflow default',
      waves: [{ id: 'wave-1', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] }],
    });

    writePlan(changeDir, plan);
    const result = validatePlan(changeDir, readPlan(changeDir));

    assert.equal(result.valid, true, result.failures.join('\n'));
    assert.equal(result.plan.mode, 'sdd');
    assert.equal(readState(changeDir).execution_plan_hash, plan.hash);
  });

  it('preserves a user-confirmed non-recommended selection in the plan hash', () => {
    const plan = createPlan(changeDir, {
      mode: 'inline',
      source: 'user-confirmed',
      rationale: 'operator accepts the serial execution risk',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1', '1.2'], depends_on: [] }],
      recommendation: {
        available_modes: ['inline', 'batch-inline', 'sdd'],
        recommendation: { mode: 'batch-inline', reasons: ['Two tasks are within the threshold.'] },
        facts: { workflow: 'full' },
      },
      selection: {
        confirmed: true,
        followed_recommendation: false,
        acknowledged_non_recommendation: true,
      },
    });

    assert.equal(plan.selection.acknowledged_non_recommendation, true);
    assert.equal(plan.recommendation.recommendation.mode, 'batch-inline');
  });

  it('invalidates a legacy full plan without recommendation and confirmation evidence', () => {
    const plan = createRawPlan(changeDir, {
      mode: 'sdd',
      source: 'legacy',
      rationale: 'legacy execution plan',
      waves: [{ id: 'wave-1', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] }],
    });
    writePlan(changeDir, plan);

    const result = validatePlan(changeDir, readPlan(changeDir));

    assert.equal(result.valid, false);
    assert.match(result.failures.join('\n'), /recommendation.*required|selection.*required/i);
  });

  it('invalidates a revision whose recommendation skips the immediately prior plan', () => {
    const first = createPlan(changeDir, {
      mode: 'sdd',
      source: 'user-confirmed',
      rationale: 'initial execution plan',
      waves: [{ id: 'wave-1', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] }],
    });
    writePlan(changeDir, first);
    writeFileSync(join(changeDir, '.spec-superflow.yaml'), readFileSync(join(changeDir, '.spec-superflow.yaml'), 'utf8')
      .replace(/^revision:.*$/m, 'revision: 4'));
    const receipt = createRecommendationReceipt(changeDir, first.waves);
    const revised = createRawPlan(changeDir, {
      mode: 'sdd',
      source: 'user-confirmed-revision',
      rationale: 'skips an execution plan revision',
      waves: first.waves,
      revision: 4,
      recommendation: receipt.recommendation,
      recommendationReceipt: receipt,
      selection: {
        confirmed: true,
        followed_recommendation: true,
        acknowledged_non_recommendation: false,
      },
    });
    writePlan(changeDir, revised);

    const result = validatePlan(changeDir, readPlan(changeDir));

    assert.equal(result.valid, false);
    assert.match(result.failures.join('\n'), /recommendation receipt.*prior|recommendation.*revision/i);
  });

  it('rejects parallel waves with self and unknown dependencies', () => {
    assert.throws(() => createPlan(changeDir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'invalid dependencies',
      waves: [{ id: 'wave-1', strategy: 'parallel', tasks: ['1.1'], depends_on: ['wave-1'] }],
    }), /cannot depend on itself/);

    assert.throws(() => createPlan(changeDir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'invalid dependencies',
      waves: [{ id: 'wave-1', strategy: 'parallel', tasks: ['1.1'], depends_on: ['missing'] }],
    }), /unknown wave/);
  });

  it('rejects dependency cycles and duplicate task IDs in any wave', () => {
    assert.throws(() => createPlan(changeDir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'cyclic dependencies',
      waves: [
        { id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: ['wave-2'] },
        { id: 'wave-2', strategy: 'serial', tasks: ['1.2'], depends_on: ['wave-1'] },
      ],
    }), /dependency cycle/);

    assert.throws(() => createPlan(changeDir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'duplicate parallel task',
      waves: [{ id: 'wave-1', strategy: 'parallel', tasks: ['1.1', '1.1'], depends_on: [] }],
    }), /duplicate tasks/);

    assert.throws(() => createPlan(changeDir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'duplicate task across waves',
      waves: [
        { id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] },
        { id: 'wave-2', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] },
      ],
    }), /duplicate task.*1\.1/i);
  });

  it('changes the plan hash when plan content changes', () => {
    const first = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'first rationale',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    const second = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'second rationale',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });

    assert.notEqual(first.hash, second.hash);
  });

  it('marks a plan stale after its frozen artifacts change', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'freeze current artifacts',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Changed task\n');

    const result = validatePlan(changeDir, readPlan(changeDir));

    assert.equal(result.valid, false);
    assert.ok(result.failures.includes('execution plan is stale: artifacts hash mismatch'));
  });

  it('keeps a plan current when only legal task checkbox states change', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'freeze current artifacts',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 First task\n- [X] 1.2 Second task\n');

    const result = validatePlan(changeDir, readPlan(changeDir));

    assert.equal(result.valid, true, result.failures.join('\n'));
  });

  it('marks a plan stale after its frozen contract changes', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'freeze current contract',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);
    writeFileSync(join(changeDir, 'execution-contract.md'), '# Execution Contract\n\nChanged contract.\n');

    const result = validatePlan(changeDir, readPlan(changeDir));

    assert.equal(result.valid, false);
    assert.ok(result.failures.includes('execution plan is stale: contract hash mismatch'));
  });

  it('marks a plan stale when the state revision changes', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'freeze current revision',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);
    writeFileSync(join(changeDir, '.spec-superflow.yaml'), [
      'state: approved-for-build',
      'workflow: full',
      'revision: 3',
      `execution_plan_hash: ${plan.hash}`,
      '',
    ].join('\n'));

    const result = validatePlan(changeDir, readPlan(changeDir));

    assert.equal(result.valid, false);
    assert.ok(result.failures.includes('execution plan revision does not match state'));
  });

  it('rejects a persisted plan when its state plan revision is deleted or differs', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'freeze persisted plan revision',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);

    const stateVariants = [
      [
        'state: approved-for-build',
        'workflow: full',
        'revision: 2',
        `execution_plan_hash: ${plan.hash}`,
      ],
      [
        'state: approved-for-build',
        'workflow: full',
        'revision: 2',
        `execution_plan_hash: ${plan.hash}`,
        'execution_plan_revision: null',
      ],
      [
        'state: approved-for-build',
        'workflow: full',
        'revision: 2',
        `execution_plan_hash: ${plan.hash}`,
        'execution_plan_revision:',
      ],
      [
        'state: approved-for-build',
        'workflow: full',
        'revision: 2',
        `execution_plan_hash: ${plan.hash}`,
        'execution_plan_revision: 3',
      ],
    ];

    for (const state of stateVariants) {
      writeFileSync(join(changeDir, '.spec-superflow.yaml'), `${state.join('\n')}\n`);
      const result = validatePlan(changeDir, readPlan(changeDir));
      assert.equal(result.valid, false);
      assert.ok(result.failures.includes('execution plan revision does not match state'));
    }
  });

  it('records review receipts only for known waves', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'review gate',
      waves: [{ id: 'wave-1', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] }],
    });
    writePlan(changeDir, plan);

    const reportPath = writeReviewReport('wave-1.md');
    const receipt = recordReview(changeDir, 'wave-1', {
      status: 'pass', base: gitRefs.base, head: gitRefs.head, report: reportPath,
    });

    assert.equal(receipt.status, 'pass');
    assert.ok(receipt.recorded_at);
    const reviewsDir = join(changeDir, '.superpowers', 'sdd', 'reviews');
    const receiptFiles = readdirSync(reviewsDir).filter(fileName => fileName.endsWith('.json'));
    assert.equal(receiptFiles.length, 1);
    assert.deepEqual(
      JSON.parse(readFileSync(join(reviewsDir, receiptFiles[0]), 'utf8')),
      receipt,
    );
    assert.throws(
      () => recordReview(changeDir, 'unknown-wave', {
        status: 'pass', base: gitRefs.base, head: gitRefs.head, report: reportPath,
      }),
      /unknown wave/,
    );
  });

  it('initializes the review overlay when an execution plan is written', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'first review must not need mkdir',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });

    writePlan(changeDir, plan);

    assert.equal(existsSync(join(changeDir, '.superpowers', 'sdd', 'reviews')), true);
  });

  it('persists receipts independently for wave IDs with encoded-name collisions', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'review receipt naming',
      waves: [
        { id: 'a%', strategy: 'serial', tasks: ['1.1'], depends_on: [] },
        { id: 'a_25', strategy: 'serial', tasks: ['1.2'], depends_on: ['a%'] },
      ],
    });
    writePlan(changeDir, plan);

    const percentReport = writeReviewReport('percent.md', 'Percent wave passed.\n');
    const underscoreReport = writeReviewReport('underscore.md', 'Underscore wave failed.\n');
    recordReview(changeDir, 'a%', {
      status: 'pass', base: gitRefs.base, head: gitRefs.head, report: percentReport,
    });
    recordReview(changeDir, 'a_25', {
      status: 'fail', base: gitRefs.base, head: gitRefs.head, report: underscoreReport,
    });

    const reviewsDir = join(changeDir, '.superpowers', 'sdd', 'reviews');
    const receipts = readdirSync(reviewsDir)
      .filter(fileName => fileName.endsWith('.json'))
      .sort()
      .map(fileName => JSON.parse(readFileSync(join(reviewsDir, fileName), 'utf8')));
    assert.equal(receipts.length, 2);
    assert.ok(receipts.some(receipt => receipt.report === join('.superpowers', 'sdd', 'reviews', 'percent.md')));
    assert.ok(receipts.some(receipt => receipt.report === join('.superpowers', 'sdd', 'reviews', 'underscore.md')));
  });

  it('rejects missing, non-file, empty, and symbolic-link report evidence before writing a receipt', { skip: !canCreateSymlink() }, () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'review evidence must be durable',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);

    const reportsDir = join(changeDir, '.superpowers', 'sdd', 'reviews');
    mkdirSync(reportsDir, { recursive: true });
    const emptyReport = join(reportsDir, 'empty.md');
    const directoryReport = join(reportsDir, 'directory');
    const validReport = writeReviewReport('valid.md');
    const symlinkReport = join(reportsDir, 'symlink.md');
    writeFileSync(emptyReport, '');
    mkdirSync(directoryReport);
    symlinkSync(validReport, symlinkReport);

    for (const report of [
      join(reportsDir, 'missing.md'),
      directoryReport,
      emptyReport,
      symlinkReport,
    ]) {
      assert.throws(() => recordReview(changeDir, 'wave-1', {
        status: 'pass', base: gitRefs.base, head: gitRefs.head, report,
      }), /report evidence|review report/i);
      assert.equal(lstatSync(join(reportsDir, 'valid.md')).isFile(), true);
      assert.equal(readdirSync(reportsDir).filter(fileName => fileName.endsWith('.json')).length, 0);
    }
  });

  it('preserves a legitimate review report path in the receipt', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'retain report path for audit',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);
    const reportPath = writeReviewReport('audit.md');

    const receipt = recordReview(changeDir, 'wave-1', {
      status: 'pass', base: gitRefs.base, head: gitRefs.head, report: reportPath,
    });

    assert.equal(receipt.report, join('.superpowers', 'sdd', 'reviews', 'audit.md'));
  });

  it('starts repair state from the first failed review and rejects a non-contiguous repair range', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'repair ranges must be auditable',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);
    recordReview(changeDir, 'wave-1', {
      status: 'fail', base: gitRefs.base, head: gitRefs.head, report: writeReviewReport('initial-fail.md'),
    });

    const afterFailure = describeWaves(changeDir, plan)[0];
    assert.equal(afterFailure.repair.status, 'repairing');
    assert.equal(afterFailure.repair.failure_count, 1);
    assert.equal(afterFailure.repair.previous_head, gitRefs.head);

    const repairedHead = createRepairCommit('non-contiguous');
    assert.throws(() => recordReview(changeDir, 'wave-1', {
      status: 'fail', base: gitRefs.base, head: repairedHead, report: writeReviewReport('non-contiguous.md'),
    }), /repair.*base|previous.*head|continuous/i);
  });

  it('blocks a failed wave instead of reopening its repair chain when the report is deleted or replaced', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'failed review evidence must remain auditable',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);
    const reportPath = writeReviewReport('failed-evidence.md', 'Original failed review finding.\n');
    recordReview(changeDir, 'wave-1', {
      status: 'fail', base: gitRefs.base, head: gitRefs.head, report: reportPath,
    });

    rmSync(reportPath);
    let wave = describeWaves(changeDir, plan)[0];
    assert.equal(wave.receipt, null);
    assert.equal(wave.retryable, false);
    assert.equal(wave.eligible, false);
    assert.match(wave.blockers.join('\n'), /failed review report evidence is invalid|cannot be read/i);

    writeFileSync(reportPath, 'Replacement report with different content.\n');
    wave = describeWaves(changeDir, plan)[0];
    assert.equal(wave.receipt, null);
    assert.equal(wave.retryable, false);
    assert.equal(wave.eligible, false);
    assert.match(wave.blockers.join('\n'), /content no longer matches/i);
  });

  it('opens an adjudication circuit breaker after three unresolved review failures and blocks dependents', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'third failed repair requires adjudication',
      waves: [
        { id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] },
        { id: 'wave-2', strategy: 'serial', tasks: ['1.2'], depends_on: ['wave-1'] },
      ],
    });
    writePlan(changeDir, plan);

    let base = gitRefs.base;
    const head = gitRefs.head;
    for (let failure = 1; failure <= 3; failure += 1) {
      recordReview(changeDir, 'wave-1', {
        status: 'fail', base, head, report: writeReviewReport(`failure-${failure}.md`),
      });
      base = head;
    }

    const [blocked, dependent] = describeWaves(changeDir, plan);
    assert.equal(blocked.repair.status, 'adjudication-required');
    assert.equal(blocked.repair.failure_count, 3);
    assert.equal(blocked.retryable, false);
    assert.equal(blocked.eligible, false);
    assert.equal(dependent.eligible, false);
    assert.deepEqual(dependent.blockers, ['wave-1']);
  });

  it('cleans only the current plan workspace after a repaired pass while retaining its receipt and repair evidence', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'only generated current-plan files are disposable',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);
    const current = getPlanScopedPaths(changeDir, plan);
    const historical = getPlanScopedPaths(changeDir, { hash: `sha256:${'f'.repeat(64)}`, revision: plan.revision + 1 });
    mkdirSync(current.workspace, { recursive: true });
    mkdirSync(historical.workspace, { recursive: true });
    writeFileSync(join(current.workspace, 'task-brief.md'), 'regenerable current workspace file\n');
    writeFileSync(join(historical.workspace, 'task-brief.md'), 'historic workspace file\n');

    recordReview(changeDir, 'wave-1', {
      status: 'fail', base: gitRefs.base, head: gitRefs.head, report: writeReviewReport('cleanup-fail.md'),
    });
    const repairedHead = createRepairCommit('cleanup-pass');
    recordReview(changeDir, 'wave-1', {
      status: 'pass', base: gitRefs.head, head: repairedHead, report: writeReviewReport('cleanup-pass.md'),
    });

    const completed = describeWaves(changeDir, plan)[0];
    assert.equal(completed.receipt.status, 'pass');
    assert.equal(completed.repair.status, 'resolved');
    assert.equal(existsSync(current.workspace), false);
    assert.equal(existsSync(historical.workspace), true);
    assert.equal(existsSync(current.repairState), true);
  });

  it('returns validation failures instead of throwing for malformed plans', () => {
    const result = validatePlan(changeDir, { mode: 'sdd', waves: 'not-an-array' });

    assert.equal(result.valid, false);
    assert.ok(result.failures.length > 0);
  });

  it('returns validation failures for malformed dependency data', () => {
    const result = validatePlan(changeDir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'malformed dependency input',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: {} }],
    });

    assert.equal(result.valid, false);
    assert.ok(result.failures.includes('wave 1 depends_on must be an array'));
  });
});

describe('execution plan resync (plan-resync R1)', () => {
  function makeStalePlanWithPassReceipt() {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'freeze artifacts before resync',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);
    recordReview(changeDir, 'wave-1', {
      status: 'pass', base: gitRefs.base, head: gitRefs.head, report: writeReviewReport('resync-pass.md'),
    });
    // 非语义结构修正：修改 tasks.md 冻结内容，触发 artifacts_hash 变化 → plan stale
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 First task refined\n- [ ] 1.2 Second task\n');
    assert.equal(validatePlan(changeDir, readPlan(changeDir)).valid, false, 'precondition: plan must be stale');
    return plan;
  }

  it('unlocks a stale plan by refreshing hashes and migrating receipts without re-review', () => {
    makeStalePlanWithPassReceipt();

    resyncPlan(changeDir, { reason: 'non-semantic wording fix in tasks.md' });

    const result = validatePlan(changeDir, readPlan(changeDir));
    assert.equal(result.valid, true, result.failures.join('\n'));
    const current = readCurrentReview(changeDir, 'wave-1');
    assert.equal(current?.status, 'pass', 'existing receipt must remain valid without re-recording');

    const receipt = readPlan(changeDir).recommendation_receipt;
    assert.deepEqual(
      validateRecommendationReceiptStructure(receipt),
      [],
      'the recommendation receipt content seal must stay valid after resync refreshes artifacts_hash',
    );

    const progressPath = join(changeDir, '.superpowers', 'sdd', 'progress.md');
    assert.equal(existsSync(progressPath), true, 'progress ledger must exist for audit');
    const progress = readFileSync(progressPath, 'utf8');
    assert.match(progress, /non-semantic wording fix in tasks\.md/);
    assert.ok(progress.includes(current.plan_hash), 'audit must mention the new plan hash');
  });

  it('keeps root and plan-scoped receipts and the state summary on the new plan identity', () => {    makeStalePlanWithPassReceipt();

    resyncPlan(changeDir, { reason: 'identity consistency check' });

    const resynced = readPlan(changeDir);
    const reviewsDir = join(changeDir, '.superpowers', 'sdd', 'reviews');
    const scopedReviewsDir = getPlanScopedPaths(changeDir, resynced).reviews;
    for (const directory of [reviewsDir, scopedReviewsDir]) {
      const receipts = readdirSync(directory)
        .filter(fileName => fileName.endsWith('.json'))
        .map(fileName => JSON.parse(readFileSync(join(directory, fileName), 'utf8')));
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0].plan_hash, resynced.hash, `${directory} receipt plan_hash must equal the new plan hash`);
      assert.equal(receipts[0].plan_revision, resynced.revision, 'revision must stay unchanged');
    }
    assert.equal(readState(changeDir).execution_plan_hash, resynced.hash);
  });

  it('migrates plan-scoped checkpoints and handoffs so they stay visible under the resynced identity', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'checkpoint identity must follow the plan',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);
    saveCheckpoint(changeDir, { taskId: '1.1', next: 'continue with 1.2' });
    const oldIdentity = getPlanScopedPaths(changeDir, readPlan(changeDir)).planIdentity;
    // 非语义结构修正：修改 tasks.md 冻结内容，触发 artifacts_hash 变化 → plan stale
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 First task refined\n- [ ] 1.2 Second task\n');
    assert.equal(validatePlan(changeDir, readPlan(changeDir)).valid, false, 'precondition: plan must be stale');

    resyncPlan(changeDir, { reason: 'non-semantic wording fix before checkpoint lookup' });

    const resynced = readPlan(changeDir);
    const newIdentity = getPlanScopedPaths(changeDir, resynced).planIdentity;
    assert.notEqual(newIdentity, oldIdentity);
    const checkpoints = listCheckpoints(changeDir);
    assert.equal(checkpoints.length, 1, `checkpoint must be readable under the new identity (was in ${oldIdentity})`);
    assert.equal(checkpoints[0].task_id, '1.1');
    // 整目录搬移不重写内部字段：plan_hash 保留保存时的快照值，
    // 但 readers 按 planRoot 目录身份解析（legacyPlan=null 不过滤），故仍可读。
    assert.equal(checkpoints[0].plan_hash, plan.hash);
    assert.equal(getCheckpoint(changeDir, '1.1')?.task_id, '1.1');
    const plansRoot = join(changeDir, '.superpowers', 'sdd', 'plans');
    if (existsSync(join(plansRoot, oldIdentity))) {
      assert.equal(
        readdirSync(join(plansRoot, oldIdentity)).length, 0,
        'old identity directory must not retain migrated record directories',
      );
    }
    assert.equal(existsSync(join(plansRoot, newIdentity, 'checkpoints')), true);
  });

  it('still completes resync and warns when the progress audit append fails (Minor-B)', () => {
    makeStalePlanWithPassReceipt();
    // 把 progress.md 替换为同名目录：appendFileSync 写目录必然抛错，
    // 触发 audit append 的取舍分支（append-only 审计缺一行，仅告警不回滚）。
    const progressPath = join(changeDir, '.superpowers', 'sdd', 'progress.md');
    if (existsSync(progressPath)) rmSync(progressPath, { force: true });
    mkdirSync(progressPath, { recursive: true });
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    let captured = '';
    process.stderr.write = chunk => { captured += String(chunk); return true; };
    try {
      const result = resyncPlan(changeDir, { reason: 'audit append trade-off (Minor-B)' });
      assert.ok(result, 'resync must still succeed when the audit append fails');
      const validated = validatePlan(changeDir, readPlan(changeDir));
      assert.equal(validated.valid, true, validated.failures.join('\n'));
      assert.match(captured, /WARN: resync 完成但 progress.md 审计追加失败/,
        `expected an audit-failure WARN, got: ${captured}`);
    } finally {
      process.stderr.write = originalStderrWrite;
      rmSync(progressPath, { recursive: true, force: true });
    }
  });

  it('rejects resync when no execution plan exists or the plan is not stale', () => {
    // plan 不存在
    assert.throws(() => resyncPlan(changeDir, { reason: 'no plan yet' }), /execution plan/i);

    // plan 存在但未 stale（no-op 保护）
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'current plan must refuse resync',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);
    const planBefore = readFileSync(join(changeDir, '.superpowers', 'sdd', 'execution-plan.json'), 'utf8');
    assert.throws(() => resyncPlan(changeDir, { reason: 'nothing changed' }), /no need to resync|not stale/i);
    assert.equal(readFileSync(join(changeDir, '.superpowers', 'sdd', 'execution-plan.json'), 'utf8'), planBefore, 'no-op rejection must not write');
  });

  it('rejects resync while any wave has an unresolved fail receipt and lists the wave id', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'fail receipts block resync',
      waves: [
        { id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] },
        { id: 'wave-2', strategy: 'serial', tasks: ['1.2'], depends_on: ['wave-1'] },
      ],
    });
    writePlan(changeDir, plan);
    recordReview(changeDir, 'wave-1', {
      status: 'fail', base: gitRefs.base, head: gitRefs.head, report: writeReviewReport('resync-fail.md'),
    });
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Changed first task\n- [ ] 1.2 Second task\n');

    const planPath = join(changeDir, '.superpowers', 'sdd', 'execution-plan.json');
    const planBefore = readFileSync(planPath, 'utf8');
    const reviewsDirBefore = readdirSync(join(changeDir, '.superpowers', 'sdd', 'reviews')).sort();

    assert.throws(() => resyncPlan(changeDir, { reason: 'attempted while repair chain open' }), /wave-1/);
    assert.equal(readFileSync(planPath, 'utf8'), planBefore, 'fail-receipt rejection must not modify the execution plan');
    assert.deepEqual(
      readdirSync(join(changeDir, '.superpowers', 'sdd', 'reviews')).sort(),
      reviewsDirBefore,
      'fail-receipt rejection must not write any receipt file',
    );
  });

  // —— P0/P3（review-findings-fix R1/R4）测试辅助 ——

  // —— P0/P3（review-findings-fix R1/R4）测试辅助 ——

  // 注错原则：ESM 解构导入的绑定不可重写（execution-plan.mjs 内部解构导入
  // writeFileSync/renameSync），故一律制造真实文件系统故障来命中迁移中途。
  // 注入点都保证必然抛错：目录出现在文件路径上 → readFileSync/renameSync
  // 抛 EISDIR/EPERM；父路径是普通文件 → mkdirSync 抛 ENOTDIR。

  // 预测 resync 后的新 plan identity：把 change 复制到临时目录并真实 resync，
  // 读回新 plan 推导身份。resync 对 plan 的改写是确定性的，因此该身份与真实
  // change 目录内执行 resync 将产生的新身份一致（避免在测试里复制内部 hashPlan）。
  function resyncPreviewIdentity(changeDir) {
    const tempRoot = mkdtempSync(join(tmpdir(), 'ssf-resync-preview-'));
    const tempChange = join(tempRoot, 'preview');
    cpSync(changeDir, tempChange, { recursive: true });
    try {
      resyncPlan(tempChange, { reason: 'identity preview for fault injection' });
      return getPlanScopedPaths(tempChange, readPlan(tempChange)).planIdentity;
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  // 把 state summary 文件（.spec-superflow.yaml）替换为同名目录：resync 尾部
  // 更新 summary 时（写前预读旧内容）必然抛 EISDIR——精确命中"plan 已写、
  // summary 即将写"的 C1 位置。dispose 恢复原文件内容。
  function withStateSummaryBlocked(run) {
    const statePath = join(changeDir, '.spec-superflow.yaml');
    const original = existsSync(statePath) ? readFileSync(statePath, 'utf8') : null;
    rmSync(statePath, { recursive: true, force: true });
    mkdirSync(statePath);
    try {
      run();
    } finally {
      rmSync(statePath, { recursive: true, force: true });
      if (original !== null) writeFileSync(statePath, original);
    }
  }

  // 构造含两个 pass receipt + overlay + checkpoint 的 stale 场景，并记录迁移
  // 涉及的每个文件写入前的旧内容快照（供回滚断言比对）。
  function makeStaleScenarioWithMultipleReceipts() {
    const waves = [
      { id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] },
      { id: 'wave-2', strategy: 'serial', tasks: ['1.2'], depends_on: ['wave-1'] },
    ];
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'atomic resync with several receipts',
      waves,
    });
    writePlan(changeDir, plan);
    recordReview(changeDir, 'wave-1', {
      status: 'pass', base: gitRefs.base, head: gitRefs.head, report: writeReviewReport('resync-pass-1.md'),
    });
    recordReview(changeDir, 'wave-2', {
      status: 'pass', base: gitRefs.base, head: gitRefs.head, report: writeReviewReport('resync-pass-2.md'),
    });
    saveCheckpoint(changeDir, { taskId: '1.1', next: 'continue after resync' });
    // 预置 overlay（resync 迁移第一项）：写入时 artifacts_hash 与 plan 一致，
    // 随后修改 tasks.md 使 plan 与 overlay 同时 stale。
    writeRecommendationReceipt(changeDir, createRecommendationReceipt(changeDir, waves));
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 First task refined\n- [ ] 1.2 Second task\n');
    assert.equal(validatePlan(changeDir, readPlan(changeDir)).valid, false, 'precondition: plan must be stale');

    const planPath = join(changeDir, '.superpowers', 'sdd', 'execution-plan.json');
    return {
      plan,
      oldPlanJson: readFileSync(planPath, 'utf8'),
      oldOverlayReceipt: structuredClone(readRecommendationReceipt(changeDir)),
      reviewFilesOldContent: readAllReceiptContents(join(changeDir, '.superpowers', 'sdd', 'reviews')),
    };
  }

  function readAllReceiptContents(directory) {
    if (!existsSync(directory)) return {};
    const contents = {};
    for (const name of readdirSync(directory).filter(fileName => fileName.endsWith('.json'))) {
      contents[join(directory, name)] = readFileSync(join(directory, name), 'utf8');
    }
    return contents;
  }

  function readScopedAndRootReceiptValues() {
    const resynced = readPlan(changeDir);
    const directories = [join(changeDir, '.superpowers', 'sdd', 'reviews'), getPlanScopedPaths(changeDir, resynced).reviews];
    const values = [];
    for (const directory of directories) {
      for (const fileName of readdirSync(directory).filter(name => name.endsWith('.json'))) {
        values.push(JSON.parse(readFileSync(join(directory, fileName), 'utf8')));
      }
    }
    return { values, resynced };
  }

  // 用 monkey-patch 包装模块导出函数的尝试已确认不可行（ESM 解构绑定不可重写），
  // 相关半成品（injectRenameFailure / injectRenameFailureAtWriteCount /
  // injectFailureOnDirectoryMove）已删除，避免误导后续维护者；注错一律走真实
  // 文件系统故障（见 resyncPreviewIdentity / withStateSummaryBlocked 等辅助）。
  function withCheckpointTargetBlocked(run) {
    const plansRoot = join(changeDir, '.superpowers', 'sdd', 'plans');
    if (existsSync(plansRoot)) {
      rmSync(plansRoot, { recursive: true, force: true });
    }
    writeFileSync(plansRoot, 'blocked');
    try {
      run();
    } finally {
      try { rmSync(plansRoot, { force: true }); } catch { /* best effort */ }
    }
  }

  it('restores every migrated file when a receipt migration fails mid-way (P0-A)', () => {
    const context = makeStaleScenarioWithMultipleReceipts();
    // 预测 resync 后的新身份（在干净的临时副本上真实 resync，推导确定性一致），
    // 以便把注入点精确放在"第二个 receipt 即将写入新身份"的目标路径上。
    const previewIdentity = resyncPreviewIdentity(changeDir);
    const migratedReviews = join(changeDir, '.superpowers', 'sdd', 'plans', previewIdentity, 'reviews');
    // C2 关键验证标准：注入必须真能命中 receipts 迁移中途，绝不允许 resync
    // 意外成功而静默跳过断言。把第二个 receipt（wave-2）在新身份下的目标路径
    // 预置为同名目录：第一个 receipt 的写回与目标副本完成后，第二个 receipt 的
    // 目标副本（writeWithUndo 写前预读旧内容）在目录上必然抛 EISDIR/EPERM——
    // 命中点精确落在"第一个已写、第二个即将写"，且任何平台都必然抛错。
    const secondReceiptName = `${Buffer.from('wave-2', 'utf8').toString('base64url')}.json`;
    const firstReceiptName = `${Buffer.from('wave-1', 'utf8').toString('base64url')}.json`;
    mkdirSync(join(migratedReviews, secondReceiptName), { recursive: true });

    let caught;
    try {
      resyncPlan(changeDir, { reason: 'mid-receipt-migration injected failure' });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, 'resync must fail when the second receipt target copy is blocked');
    // (d) 错误信息含原始原因（文件系统 EISDIR/EPERM）
    assert.match(caught.message, /EISDIR|EPERM|ENOTDIR|not a directory|illegal operation/i);

    // (a) plan 文件保持旧 hash 内容
    const planPath = join(changeDir, '.superpowers', 'sdd', 'execution-plan.json');
    assert.equal(readFileSync(planPath, 'utf8'), context.oldPlanJson, 'plan file must be rolled back to the pre-resync content');

    // (b) 已写出的 root receipts 恢复旧 plan_hash（第一个已写的 receipt 被恢复）
    const reviewsDir = join(changeDir, '.superpowers', 'sdd', 'reviews');
    for (const [filePath, oldContent] of Object.entries(context.reviewFilesOldContent)) {
      if (!existsSync(filePath)) continue;
      assert.equal(readFileSync(filePath, 'utf8'), oldContent, `receipt ${filePath} must keep its pre-resync content`);
    }
    for (const receipt of readdirSync(reviewsDir).filter(name => name.endsWith('.json'))
      .map(name => JSON.parse(readFileSync(join(reviewsDir, name), 'utf8')))) {
      assert.equal(receipt.plan_hash, context.plan.hash, 'all rolled-back receipts must reference the old plan hash');
    }
    // 迁移到新身份的第一个 receipt 目标副本也随撤销日志删除（副本同样注册了 undo）
    assert.equal(existsSync(join(migratedReviews, firstReceiptName)), false,
      'the migrated target copy of the first receipt must be rolled back too');

    // (c) overlay 被恢复为 resync 前内容
    assert.deepEqual(readRecommendationReceipt(changeDir), context.oldOverlayReceipt, 'overlay must be rolled back');

    // 系统回到自洽 stale 态：移除注入点后可重新 resync 并成功
    rmSync(join(migratedReviews, secondReceiptName), { recursive: true, force: true });
    resyncPlan(changeDir, { reason: 'retry after injected failure' });
    assert.equal(validatePlan(changeDir, readPlan(changeDir)).valid, true);
  });

  it('keeps the system fully consistent when the directory migration step fails (P0)', () => {
    const plan = makeStalePlanWithPassReceipt();
    saveCheckpoint(changeDir, { taskId: '1.1', next: 'continue after directory-move failure' });
    const oldPlanJson = readFileSync(join(changeDir, '.superpowers', 'sdd', 'execution-plan.json'), 'utf8');
    const reviewsSnapshot = readAllReceiptContents(join(changeDir, '.superpowers', 'sdd', 'reviews'));

    // 注错：把整个 plans 目录替换为普通文件——receipts 迁移向新身份写目标副本
    // 时 mkdirSync(plans/<newIdentity>/...) 落在文件父路径上必然抛 ENOTDIR。
    let caught;
    try {
      withCheckpointTargetBlocked(() => {
        resyncPlan(changeDir, { reason: 'directory move injected failure' });
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, 'the migration failure must propagate unchanged');

    assert.equal(readFileSync(join(changeDir, '.superpowers', 'sdd', 'execution-plan.json'), 'utf8'), oldPlanJson,
      'plan file must stay on the pre-resync content after a migration failure');
    const freshReviews = readAllReceiptContents(join(changeDir, '.superpowers', 'sdd', 'reviews'));
    assert.deepEqual(freshReviews, reviewsSnapshot, 'all receipt files must equal their pre-resync content');
    const current = readCurrentReview(changeDir, 'wave-1', plan);
    assert.equal(current?.status, 'pass', 'rolled-back receipts must still be valid evidence for the old plan');
  });

  it('rolls back the plan file and receipts when the tail summary write fails (C1)', () => {
    const context = makeStaleScenarioWithMultipleReceipts();
    const progressPath = join(changeDir, '.superpowers', 'sdd', 'progress.md');
    const progressBefore = existsSync(progressPath) ? readFileSync(progressPath, 'utf8') : '';

    // 在尾部注入失败：state summary 文件被替换为同名目录，resync 写 plan 之后、
    // 更新 summary 时（写前预读旧内容）必然抛 EISDIR——正是 C1 判定的
    // "plan 已落盘、summary 即将写"死锁窗口。
    let caught;
    try {
      withStateSummaryBlocked(() => {
        resyncPlan(changeDir, { reason: 'tail summary injected failure' });
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, 'resync must fail when the state summary write is blocked');

    // plan 文件恢复旧 hash 内容（已随 writeWithUndo 注册撤销）
    const planPath = join(changeDir, '.superpowers', 'sdd', 'execution-plan.json');
    assert.equal(readFileSync(planPath, 'utf8'), context.oldPlanJson, 'plan file must be rolled back to the pre-resync content');

    // 全部 root receipts 恢复旧 plan_hash
    const reviewsDir = join(changeDir, '.superpowers', 'sdd', 'reviews');
    for (const [filePath, oldContent] of Object.entries(context.reviewFilesOldContent)) {
      if (!existsSync(filePath)) continue;
      assert.equal(readFileSync(filePath, 'utf8'), oldContent, `receipt ${filePath} must keep its pre-resync content`);
    }

    // overlay 恢复旧值
    assert.deepEqual(readRecommendationReceipt(changeDir), context.oldOverlayReceipt, 'overlay must be rolled back');

    // 目录搬移撤销闭包生效：checkpoint 回到旧身份目录
    const oldIdentity = getPlanScopedPaths(changeDir, readPlan(changeDir)).planIdentity;
    const oldCheckpoints = join(changeDir, '.superpowers', 'sdd', 'plans', oldIdentity, 'checkpoints');
    assert.equal(existsSync(join(oldCheckpoints, '1.1.md')), true, 'the moved checkpoint must be restored under the old identity');

    // 取舍声明（C1）：progress.md 是 append 型审计日志，失败的 resync 不写入
    // 审计行（回滚也不截断它）——追加失败可容忍，这里断言失败路径不留半截审计。
    const progressAfter = existsSync(progressPath) ? readFileSync(progressPath, 'utf8') : '';
    assert.equal(progressAfter, progressBefore, 'a failed resync must not append any audit line');

    // 系统回到自洽 stale 态：可重新 resync 并成功（审计在成功路径照常追加）
    resyncPlan(changeDir, { reason: 'retry after tail failure' });
    assert.equal(validatePlan(changeDir, readPlan(changeDir)).valid, true);
    assert.match(readFileSync(progressPath, 'utf8'), /## Execution Plan Resync/, 'the retry audit line must be appended on success');
  });

  it('moves back entry-level directory entries through the reverse restore closure (I2)', () => {
    // 构造只有 checkpoint（无 reviews）的 stale 场景：checkpoint 搬走后旧身份
    // 目录被 removeDirIfEmpty 清空，restore 闭包必须 mkdir 兜底（I1）才能逆序搬回。
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'entry-level restore closure coverage',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);
    saveCheckpoint(changeDir, { taskId: '1.1', next: 'continue after entry-move rollback' });
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 First task refined\n- [ ] 1.2 Second task\n');
    assert.equal(validatePlan(changeDir, readPlan(changeDir)).valid, false, 'precondition: plan must be stale');

    const oldPlanJson = readFileSync(join(changeDir, '.superpowers', 'sdd', 'execution-plan.json'), 'utf8');
    const oldIdentity = getPlanScopedPaths(changeDir, readPlan(changeDir)).planIdentity;
    const previewIdentity = resyncPreviewIdentity(changeDir);
    // 预置新身份 checkpoints 目标为已存在的目录（含哨兵文件），使搬移走
    // target-exists 分支（entry 级逐个 rename + 逆序 restore 闭包），而非整目录 rename。
    const migratedCheckpoints = join(changeDir, '.superpowers', 'sdd', 'plans', previewIdentity, 'checkpoints');
    mkdirSync(migratedCheckpoints, { recursive: true });
    writeFileSync(join(migratedCheckpoints, 'sentinel.txt'), 'pre-existing\n');

    // 在尾部 summary 写入注入失败：plan 已落盘、checkpoint 已逐项搬移，catch 侧
    // restoreUndoLog 逆序执行 entry 级 restore 闭包（I1 mkdir 兜底 + I2 逆序搬回）。
    let caught;
    try {
      withStateSummaryBlocked(() => {
        resyncPlan(changeDir, { reason: 'entry-level move restore injected failure' });
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, 'resync must fail when the tail summary write is blocked');

    assert.equal(readFileSync(join(changeDir, '.superpowers', 'sdd', 'execution-plan.json'), 'utf8'), oldPlanJson,
      'plan file must be rolled back to the pre-resync content');
    // 逆序搬回生效：checkpoint 回到旧身份目录，且不残留于新身份目标
    const oldCheckpoints = join(changeDir, '.superpowers', 'sdd', 'plans', oldIdentity, 'checkpoints');
    assert.equal(existsSync(join(oldCheckpoints, '1.1.md')), true, 'the checkpoint must be moved back under the old identity');
    assert.deepEqual(readdirSync(migratedCheckpoints), ['sentinel.txt'],
      'the migrated target must retain only its pre-existing sentinel after the entry-level rollback');

    // 系统回到自洽 stale 态：可重新 resync 并成功（目标已存在 → 再次走 entry 级搬移）
    resyncPlan(changeDir, { reason: 'retry after entry-move rollback' });
    assert.equal(validatePlan(changeDir, readPlan(changeDir)).valid, true);
    assert.equal(existsSync(join(migratedCheckpoints, '1.1.md')), true, 'the retry must migrate the checkpoint onto the new identity');
  });

  it('refreshes the recommendation overlay artifacts_hash and reseals it during resync (P3)', () => {
    makeStalePlanWithPassReceipt();
    // 写入一份带旧 artifacts_hash 的 overlay 文件（模拟 ssf execution recommend
    // 在 plan 冻结前生成的持久化 receipt），随后修改 tasks.md 使其 stale。
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 First task pre-overlay\n');
    const overlay = createRecommendationReceipt(changeDir, [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }]);
    writeRecommendationReceipt(changeDir, overlay);
    assert.equal(readRecommendationReceipt(changeDir).artifacts_hash, computeArtifactsHash(changeDir), 'precondition: overlay starts current');
    // 非语义修正 → plan 与 overlay 同时 stale
    writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 First task refined post-overlay\n');

    resyncPlan(changeDir, { reason: 'overlay sync check' });

    const refreshed = readRecommendationReceipt(changeDir);
    assert.notEqual(refreshed, null);
    assert.deepEqual(validateRecommendationReceiptStructure(refreshed), [], 'overlay seal must remain valid after resync');
    assert.equal(refreshed.artifacts_hash, computeArtifactsHash(changeDir), 'overlay artifacts_hash must equal the current snapshot hash');
  });

  it('rejects the review with a clear error when head branch verification fails (P2)', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'head branch verification failure must not silently pass',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);

    // 注入 runGit：rev-parse --show-toplevel 透传（validateReviewRange 走模块级
    // defaultGitRangeValidator，仍用真实 git，故该步先成功）；assertReviewHeadBranch
    // 的 git branch --contains 调用抛错——真实命中 R4 的 throw 路径而非
    // validateReviewRange 的既有 git-root 错误（终审 final-review-c4a921c Important-A）。
    const runGitForBranchFailure = (args, opts) => {
      if (args.includes('--contains')) {
        throw new Error('simulated git branch --contains failure');
      }
      return execFileSync('git', args, opts);
    };
    const reportPath = writeReviewReport('p2-branch-fail.md');
    assert.throws(
      () => recordReview(changeDir, 'wave-1', {
        status: 'pass', base: gitRefs.base, head: gitRefs.head, report: reportPath,
      }, { runGit: runGitForBranchFailure }),
      error => /Review head branch verification failed for commit/i.test(error.message),
      'review must be rejected when branch verification fails',
    );
    assert.equal(
      readdirSync(join(changeDir, '.superpowers', 'sdd', 'reviews')).filter(name => name.endsWith('.json')).length,
      0,
      'no receipt may be written',
    );
  });
});

describe('execution review branch protection (worktree-lifecycle R4)', () => {
  it('records a review receipt when head is on a non-protected isolated branch', () => {
    const defaultBranch = runGit(changeDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const isolatedHead = commitOnNewBranch('isolation-ok', 'feature');
    // head 只被隔离分支包含（不落在默认分支上）
    const containing = containingBranches(isolatedHead);
    assert.deepEqual(containing, ['isolation-ok']);
    assert.notEqual(defaultBranch, 'isolation-ok');

    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'review an isolated branch commit',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);

    const receipt = recordReview(changeDir, 'wave-1', {
      status: 'pass', base: gitRefs.base, head: isolatedHead, report: writeReviewReport('isolation-ok.md'),
    });

    assert.equal(receipt.status, 'pass');
    assert.equal(receipt.head, isolatedHead);
  });

  it('rejects review and writes no receipt when head is only contained by a protected branch', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'review must not target main directly',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);
    // 移除 beforeEach 建立的隔离分支，使 head 只被 protected 默认分支包含
    runGit(changeDir, ['branch', '-D', 'test-isolation']);

    assert.throws(() => recordReview(changeDir, 'wave-1', {
      status: 'pass', base: gitRefs.base, head: gitRefs.head, report: writeReviewReport('direct-main.md'),
    }), /protected|isolated/i);

    const reviewsDir = join(changeDir, '.superpowers', 'sdd', 'reviews');
    assert.equal(readdirSync(reviewsDir).filter(fileName => fileName.endsWith('.json')).length, 0);
  });

  it('allows review after the isolated branch is merged back into the default branch', () => {
    const defaultBranch = runGit(changeDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const isolatedHead = commitOnNewBranch('isolation-merged', 'feature');
    runGit(changeDir, ['checkout', '--quiet', defaultBranch]);
    runGit(changeDir, ['merge', '--quiet', '--no-ff', 'isolation-merged', '-m', 'merge isolation back']);
    // head 同时被默认分支与隔离分支包含 → 放行
    const containing = containingBranches(isolatedHead);
    assert.ok(containing.includes('isolation-merged'), containing.join(','));
    assert.ok(containing.includes(defaultBranch), containing.join(','));

    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'review a merged isolated commit',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);

    const receipt = recordReview(changeDir, 'wave-1', {
      status: 'pass', base: gitRefs.base, head: isolatedHead, report: writeReviewReport('merged-back.md'),
    });

    assert.equal(receipt.status, 'pass');
    assert.equal(receipt.head, isolatedHead);
  });
});
