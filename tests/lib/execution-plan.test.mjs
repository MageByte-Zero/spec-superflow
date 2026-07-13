import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createPlan, readPlan, recordReview, validatePlan, writePlan,
} from '../../scripts/lib/execution-plan.mjs';
import { readState } from '../../scripts/lib/state-loader.mjs';

let changeDir;

beforeEach(() => {
  changeDir = mkdtempSync(join(tmpdir(), 'execution-plan-'));
  writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 First task\n- [ ] 1.2 Second task\n');
  writeFileSync(join(changeDir, 'execution-contract.md'), '# Execution Contract\n\nCurrent contract.\n');
  writeFileSync(join(changeDir, '.spec-superflow.yaml'), 'state: approved-for-build\nworkflow: full\nrevision: 2\n');
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
});

function writeReviewReport(name, content = 'Review completed without blocking findings.\n') {
  const reportsDir = join(changeDir, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = join(reportsDir, name);
  writeFileSync(reportPath, content);
  return reportPath;
}

describe('execution plan data contract', () => {
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

  it('rejects batch-inline without an explicit user override', () => {
    assert.throws(() => createPlan(changeDir, {
      mode: 'batch-inline', source: 'default', rationale: 'fast', waves: [],
    }), /explicit user override/);
  });

  it('rejects an inline plan without an explicit user override', () => {
    assert.throws(() => createPlan(changeDir, {
      mode: 'inline', source: 'automatic', rationale: 'fast', waves: [],
    }), /explicit user override/);
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
      status: 'pass', base: 'abc1234', head: 'def5678', report: reportPath,
    });

    assert.equal(receipt.status, 'pass');
    assert.ok(receipt.recorded_at);
    const reviewsDir = join(changeDir, '.superpowers', 'sdd', 'reviews');
    const receiptFiles = readdirSync(reviewsDir);
    assert.equal(receiptFiles.length, 1);
    assert.deepEqual(
      JSON.parse(readFileSync(join(reviewsDir, receiptFiles[0]), 'utf8')),
      receipt,
    );
    assert.throws(
      () => recordReview(changeDir, 'unknown-wave', {
        status: 'pass', base: 'abc1234', head: 'def5678', report: reportPath,
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
      status: 'pass', base: 'base-percent', head: 'head-percent', report: percentReport,
    });
    recordReview(changeDir, 'a_25', {
      status: 'fail', base: 'base-underscore', head: 'head-underscore', report: underscoreReport,
    });

    const reviewsDir = join(changeDir, '.superpowers', 'sdd', 'reviews');
    const receipts = readdirSync(reviewsDir)
      .sort()
      .map(fileName => JSON.parse(readFileSync(join(reviewsDir, fileName), 'utf8')));
    assert.equal(receipts.length, 2);
    assert.ok(receipts.some(receipt => receipt.report === percentReport));
    assert.ok(receipts.some(receipt => receipt.report === underscoreReport));
  });

  it('rejects missing, non-file, empty, and symbolic-link report evidence before writing a receipt', () => {
    const plan = createPlan(changeDir, {
      mode: 'sdd', source: 'default', rationale: 'review evidence must be durable',
      waves: [{ id: 'wave-1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    writePlan(changeDir, plan);

    const reportsDir = join(changeDir, 'reports');
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
        status: 'pass', base: 'abc1234', head: 'def5678', report,
      }), /report evidence|review report/i);
      assert.equal(lstatSync(join(reportsDir, 'valid.md')).isFile(), true);
      assert.equal(existsSync(join(changeDir, '.superpowers', 'sdd', 'reviews')), false);
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
      status: 'pass', base: 'abc1234', head: 'def5678', report: reportPath,
    });

    assert.equal(receipt.report, reportPath);
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
