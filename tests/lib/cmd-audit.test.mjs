// tests/lib/cmd-audit.test.mjs
// Tests for scripts/lib/cmd-audit.mjs
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordDebugAttempt, recordDebugEscalation } from '../../scripts/lib/debug-attempts.mjs';
import { computeArtifactsHash, computeContractHash } from '../../scripts/lib/hash.mjs';
import { readState, rebuildState, writeState } from '../../scripts/lib/state-loader.mjs';

let tempDir;

describe('cmd-audit: generateReport()', () => {
  let generateReport, DP_NAMES;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-audit-test-'));
    const modulePath = join(process.cwd(), 'scripts/lib/cmd-audit.mjs');
    const mod = await import(modulePath);
    generateReport = mod.generateReport;
    DP_NAMES = mod.DP_NAMES;
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates report with all 8 DP rows (DP-0 through DP-7)', () => {
    const state = {
      change_name: 'test-change',
      state: 'closing',
      dp_0_result: 'confirmed',
      dp_1_result: 'confirmed: csv export',
      dp_2_result: 'approved: artifacts ok',
      dp_3_result: 'contract signed',
      dp_4_result: null,
      dp_5_result: null,
      dp_6_result: null,
      dp_7_result: null,
    };

    const report = generateReport(tempDir, state);

    // Should contain all 8 DPs in the summary table
    for (let i = 0; i <= 7; i++) {
      assert.ok(report.includes(`DP-${i}`), `Report should include DP-${i}`);
    }
  });

  it('includes change name and state in header', () => {
    const state = { change_name: 'export-csv', state: 'executing' };
    const report = generateReport(tempDir, state);

    assert.ok(report.includes('export-csv'));
    assert.ok(report.includes('executing'));
    assert.ok(report.includes('# Decision-Point Audit Report'));
  });

  it('reports correct recorded/missing counts', () => {
    const state = {
      change_name: 'test',
      state: 'specifying',
      dp_0_result: 'confirmed',
      dp_1_result: 'confirmed: ok',
      // dp_2 through dp_7 are all null (not recorded)
    };

    const report = generateReport(tempDir, state);

    assert.ok(report.includes('2/8 已记录'), `Expected 2/8 recorded but got: ${report}`);
    assert.ok(report.includes('6/8 未记录'), `Expected 6/8 missing but got: ${report}`);
  });

  it('treats confirmed DP-0 state as recorded without dp_0_result', () => {
    const state = {
      change_name: 'test',
      state: 'specifying',
      dp_0_decisions: 'scope confirmed',
      dp_0_confirmed: 'true',
      dp_0_timestamp: '2026-07-06T10:50:00Z',
    };

    const report = generateReport(tempDir, state);

    assert.ok(
      report.includes('| DP-0 | 用户确认门禁 | confirmed | 2026-07-06T10:50:00Z |'),
      `Expected DP-0 to be recorded from dp_0_confirmed but got: ${report}`,
    );
    assert.ok(report.includes('1/8 已记录'), `Expected 1/8 recorded but got: ${report}`);
  });

  it('marks unrecorded DPs with interpretation hint', () => {
    const state = {
      change_name: 'test',
      state: 'exploring',
      // No DPs recorded at all
    };

    const report = generateReport(tempDir, state);

    // Should have 'not recorded' for all DPs
    const notRecordedCount = (report.match(/not recorded/g) || []).length;
    assert.ok(notRecordedCount >= 8, `Expected at least 8 'not recorded' but got ${notRecordedCount}`);

    // Unrecorded DPs should have the interpretation hint
    assert.ok(report.includes('尚未记录结果'), 'Should include hint for unrecorded DPs');
  });

  it('includes all DP names from DP_NAMES constant', () => {
    const state = {
      change_name: 'test',
      state: 'closing',
      dp_0_result: 'ok',
      dp_0_timestamp: '2026-07-01T00:00:00Z',
      dp_1_result: 'ok',
      dp_1_timestamp: '2026-07-01T00:00:00Z',
      dp_2_result: 'ok',
      dp_2_timestamp: '2026-07-01T00:00:00Z',
      dp_3_result: 'ok',
      dp_3_timestamp: '2026-07-01T00:00:00Z',
      dp_4_result: 'ok',
      dp_4_timestamp: '2026-07-01T00:00:00Z',
      dp_5_result: 'ok',
      dp_5_timestamp: '2026-07-01T00:00:00Z',
      dp_6_result: 'ok',
      dp_6_timestamp: '2026-07-01T00:00:00Z',
      dp_7_result: 'ok',
      dp_7_timestamp: '2026-07-01T00:00:00Z',
    };

    const report = generateReport(tempDir, state);

    for (const [dpNum, name] of Object.entries(DP_NAMES)) {
      assert.ok(report.includes(name), `Report should include DP-${dpNum} name: ${name}`);
    }

    assert.ok(report.includes('7/8 已记录'));
    assert.match(report, /DP-5.*unsupported/i);
  });

  it('formats timestamps correctly', () => {
    const state = {
      change_name: 'test',
      state: 'closing',
      dp_0_result: 'confirmed',
      dp_0_timestamp: '2026-07-01T08:30:00Z',
    };

    const report = generateReport(tempDir, state);
    assert.ok(report.includes('2026-07-01T08:30:00Z'));
  });

  it('handles empty string as not recorded', () => {
    const state = {
      change_name: 'test',
      state: 'exploring',
      dp_0_result: '',
      dp_0_timestamp: '',
    };

    const report = generateReport(tempDir, state);
    assert.ok(report.includes('not recorded'), 'Empty strings should be treated as not recorded');
  });

  it('uses directory basename when change_name is null', () => {
    const state = { state: 'exploring' };
    const report = generateReport(tempDir, state);

    // tempDir basename should appear
    const dirName = tempDir.split('/').filter(Boolean).pop();
    assert.ok(report.includes(dirName), `Report should include directory name "${dirName}" as fallback`);
  });

  it('generates per-DP interpretation section for each DP', () => {
    const state = {
      change_name: 'test',
      state: 'bridging',
      dp_0_result: 'confirmed: scope ok',
    };

    const report = generateReport(tempDir, state);

    // Should have per-DP sections
    for (let i = 0; i <= 7; i++) {
      assert.ok(report.includes(`### DP-${i}`), `Report should have section for DP-${i}`);
    }

    // Recorded DP should have the recorded interpretation
    assert.ok(report.includes('已记录为'));
  });

  it('generates a valid markdown table', () => {
    const state = {
      change_name: 'test',
      state: 'specifying',
      dp_0_result: 'confirmed',
    };

    const report = generateReport(tempDir, state);

    // Verify table structure
    assert.ok(report.includes('| DP | 名称 | 结果 | 时间戳 |'), 'Should have table header');
    assert.ok(report.includes('|----|------|------|--------|'), 'Should have table separator');
  });

  it('flags a legacy DP-5 record without three attempts as unsupported', () => {
    const state = {
      change_name: 'legacy-debug-escalation',
      state: 'debugging',
      dp_5_result: 'continue: recorded through raw state set',
      dp_5_timestamp: '2026-08-06T00:00:00Z',
    };

    const report = generateReport(tempDir, state);

    assert.match(report, /DP-5.*unsupported/i);
    assert.match(report, /three|3/i);
  });

  it('counts an evidence-backed confirmed DP-5 record as supported', () => {
    const validDir = mkdtempSync(join(tmpdir(), 'ssf-audit-debug-valid-'));
    try {
      writeFileSync(join(validDir, 'proposal.md'), '## Why\nAudit a guarded DP-5 record with durable evidence.\n## What Changes\n- Guard escalation.\n');
      writeFileSync(join(validDir, 'design.md'), '# Design\n');
      writeFileSync(join(validDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Guard escalation\n');
      writeFileSync(join(validDir, 'execution-contract.md'), '# Execution Contract\n');
      rebuildState(validDir, { computeArtifactsHash, computeContractHash });
      const state = readState(validDir);
      state.state = 'debugging';
      state.workflow = 'quick';
      writeState(validDir, state);

      const evidenceDir = join(validDir, '.superpowers', 'sdd', 'debug-evidence');
      mkdirSync(evidenceDir, { recursive: true });
      for (const id of ['fix-1', 'fix-2', 'fix-3']) {
        const evidencePath = join(evidenceDir, `${id}.log`);
        writeFileSync(evidencePath, `${id} failed\n`);
        recordDebugAttempt(validDir, { id, summary: `${id} failed`, evidence: evidencePath });
      }
      recordDebugEscalation(validDir, {
        decision: 'continue',
        reason: 'Three fixes failed',
        confirm: true,
      });

      const report = generateReport(validDir, readState(validDir));
      assert.match(report, /\| DP-5 \| 调试升级 \| continue: Three fixes failed \|/);
      assert.ok(report.includes('1/8 已记录'));
      assert.doesNotMatch(report, /DP-5 unsupported/i);
    } finally {
      rmSync(validDir, { recursive: true, force: true });
    }
  });
});
