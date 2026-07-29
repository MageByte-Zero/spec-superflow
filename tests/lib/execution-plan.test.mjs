import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createPlan as createRawPlan, describeWaves, readPlan, recordReview, validatePlan, writePlan,
} from '../../scripts/lib/execution-plan.mjs';
import { createRecommendationReceipt, recommendExecutionModes } from '../../scripts/lib/execution-recommendation.mjs';
import { readState } from '../../scripts/lib/state-loader.mjs';
import { getPlanScopedPaths } from '../../scripts/lib/sdd-overlay.mjs';

let changeDir;
let gitRefs;

beforeEach(() => {
  changeDir = mkdtempSync(join(tmpdir(), 'execution-plan-'));
  writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 First task\n- [ ] 1.2 Second task\n');
  writeFileSync(join(changeDir, 'execution-contract.md'), '# Execution Contract\n\nCurrent contract.\n');
  writeFileSync(join(changeDir, '.spec-superflow.yaml'), 'state: approved-for-build\nworkflow: full\nrevision: 2\n');
  gitRefs = initializeGitRepository(changeDir);
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
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

function initializeGitRepository(directory) {
  runGit(directory, ['init', '--quiet']);
  runGit(directory, ['config', 'user.email', 'tests@example.invalid']);
  runGit(directory, ['config', 'user.name', 'Execution Plan Test']);
  runGit(directory, ['add', '--all']);
  runGit(directory, ['commit', '--quiet', '--message', 'initial execution plan change']);
  const base = runGit(directory, ['rev-parse', 'HEAD']);
  writeFileSync(join(directory, 'git-range-marker.txt'), 'second commit\n');
  runGit(directory, ['add', 'git-range-marker.txt']);
  runGit(directory, ['commit', '--quiet', '--message', 'second execution plan change']);
  return { base, head: runGit(directory, ['rev-parse', 'HEAD']) };
}

function createRepairCommit(label) {
  const marker = join(changeDir, `repair-${label}.txt`);
  writeFileSync(marker, `${label}\n`);
  runGit(changeDir, ['add', marker]);
  runGit(changeDir, ['commit', '--quiet', '--message', `repair ${label}`]);
  return runGit(changeDir, ['rev-parse', 'HEAD']);
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

  it('rejects missing, non-file, empty, and symbolic-link report evidence before writing a receipt', () => {
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

  it('opens an adjudication circuit breaker after five unresolved review failures and blocks dependents', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'fifth failed repair requires adjudication',
      waves: [
        { id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] },
        { id: 'wave-2', strategy: 'serial', tasks: ['1.2'], depends_on: ['wave-1'] },
      ],
    });
    writePlan(changeDir, plan);

    let base = gitRefs.base;
    let head = gitRefs.head;
    for (let failure = 1; failure <= 5; failure += 1) {
      recordReview(changeDir, 'wave-1', {
        status: 'fail', base, head, report: writeReviewReport(`failure-${failure}.md`),
      });
      base = head;
      head = createRepairCommit(`failure-${failure}`);
    }

    const [blocked, dependent] = describeWaves(changeDir, plan);
    assert.equal(blocked.repair.status, 'adjudication-required');
    assert.equal(blocked.repair.failure_count, 5);
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
