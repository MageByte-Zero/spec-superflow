import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard } from '../../scripts/guard/guard.mjs';
import { createRecoverySummary } from '../../scripts/lib/change-recovery.mjs';
import { readState, writeState, updateField } from '../../scripts/lib/state-loader.mjs';

function fixture(t, workflow, state = 'executing') {
  const dir = fs.mkdtempSync(join(tmpdir(), 'ssf-efficiency-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeState(dir, { ...readState(dir), workflow, state });
  return dir;
}
for (const workflow of ['quick', 'lightweight', 'tweak', 'full']) {
  test(`${workflow} can enter debugging without planning obligations`, t => {
    const dir = fixture(t, workflow);
    const sink = { write() {} };
    assert.equal(runGuard(['check', dir, 'executing', 'debugging'], { stdout: sink, stderr: sink }).exitCode, 0);
  });
}
for (const next of ['specifying', 'bridging']) {
  test(`Full debugging can rewind to ${next}`, t => {
    const dir = fixture(t, 'full', 'debugging');
    const sink = { write() {} };
    assert.equal(runGuard(['check', dir, 'debugging', next], { stdout: sink, stderr: sink }).exitCode, 0);
  });
}
test('debugging recovery routes to diagnosis even with a missing plan', t => {
  const dir = fixture(t, 'full', 'debugging');
  const result = createRecoverySummary(dir);
  assert.equal(result.next_action.skill, 'bug-investigator');
  assert.equal(result.continuation.wave, null);
});
test('legacy tweak recovery does not require an execution plan', t => {
  const dir = fixture(t, 'tweak');
  assert.deepEqual(createRecoverySummary(dir).blockers, []);
});
test('accepted decision fields survive state writes', t => {
  const dir = fixture(t, 'full');
  for (const n of [1, 2, 3, 6, 7]) {
    updateField(dir, `dp_${n}_decisions`, 'confirmed scope');
    updateField(dir, `dp_${n}_confirmed`, 'true');
    assert.equal(readState(dir)[`dp_${n}_decisions`], 'confirmed scope');
    assert.equal(readState(dir)[`dp_${n}_confirmed`], 'true');
  }
});

import { computeTaskHash } from '../../scripts/lib/sdd-overlay.mjs';
import { checkTasksComplete } from '../../scripts/guard/checks/tasks-complete.mjs';
import { checkSchemaValid } from '../../scripts/guard/checks/schema-valid.mjs';
test('template bold IDs and indentation work in checkpoints', t => {
  const dir = fixture(t, 'full');
  fs.writeFileSync(join(dir, 'tasks.md'), '  - [ ] **1.1 Implement behavior**\r\n');
  const hash = computeTaskHash(dir, '1.1');
  fs.writeFileSync(join(dir, 'tasks.md'), '  - [x] **1.1 Implement behavior**\r\n');
  assert.equal(computeTaskHash(dir, '1.1'), hash);
});
test('unknown checkbox markers cannot silently pass completion', t => {
  const dir = fixture(t, 'full');
  fs.writeFileSync(join(dir, 'tasks.md'), '- [x] 1.1 Done\n- [?] 1.2 Unknown\n');
  assert.equal(checkTasksComplete(dir).pass, false);
});
test('schema guard honors explicit specs omission', t => {
  const dir = fixture(t, 'full');
  fs.writeFileSync(join(dir, 'spec-superflow.config.json'), JSON.stringify({ artifacts: { skip: ['specs', 'design'] } }));
  assert.equal(checkSchemaValid(dir).pass, true);
});
test('Full rejects tasks omission before entering specification', t => {
  const dir = fixture(t, 'full', 'exploring');
  fs.writeFileSync(join(dir, 'spec-superflow.config.json'), JSON.stringify({ artifacts: { skip: ['tasks'] } }));
  const sink = { write() {} };
  assert.equal(runGuard(['check', dir, 'exploring', 'specifying'], { stdout: sink, stderr: sink }).exitCode, 1);
});

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
test('accepted Quick resumes and debugs without creating a Full execution plan', t => {
  const dir = fixture(t, 'auto', 'exploring');
  const cli = (...args) => execFileSync(process.execPath, [resolve('scripts/spec-superflow.mjs'), ...args], { encoding: 'utf8', stdio: 'pipe' });
  cli('workflow', 'recommend', dir, '--task-count', '1', '--file-count', '1', '--config-doc-only', 'no', '--schema-api-change', 'no', '--new-module', 'no', '--behavioral-constraint-change', 'no', '--cross-module-change', 'no', '--uncertainty', 'low', '--request-kind', 'standard');
  cli('workflow', 'accept', dir, '--source', 'direct-request', '--verification', 'bounded');
  cli('state', 'transition', dir, 'approved-for-build');
  cli('state', 'transition', dir, 'executing');
  assert.deepEqual(createRecoverySummary(dir).blockers, []);
  cli('state', 'transition', dir, 'debugging');
  assert.equal(createRecoverySummary(dir).next_action.skill, 'bug-investigator');
});
test('invalid Quick receipt requests receipt recovery, never a Full plan', t => {
  const dir = fixture(t, 'quick');
  const summary = createRecoverySummary(dir);
  assert.equal(summary.blockers[0].code, 'WORKFLOW_RECEIPT_REQUIRED');
  assert.equal(summary.execution.required, false);
});
test('debugging with lost short-path evidence repairs the receipt before diagnosis', t => {
  const dir = fixture(t, 'tweak', 'debugging');
  const summary = createRecoverySummary(dir);
  assert.equal(summary.blockers[0].code, 'WORKFLOW_RECEIPT_REQUIRED');
  assert.equal(summary.next_action.skill, 'workflow-start');
  assert.equal(summary.continuation.kind, 'blocked');
});
