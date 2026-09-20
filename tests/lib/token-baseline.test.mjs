// tests/lib/token-baseline.test.mjs
// Tests for scripts/token-baseline.mjs — measurement and comparison

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASELINE_PATH = join(process.cwd(), 'scripts/token-baseline.mjs');
const TMP = tmpdir();

describe('token-baseline: measurement', () => {
  it('outputs valid JSON with components and totals', () => {
    const out = execSync(`node "${BASELINE_PATH}" --files hooks/session-start`, { encoding: 'utf-8' });
    const data = JSON.parse(out);
    assert.ok(Array.isArray(data.components), 'components should be an array');
    assert.ok(data.components.length > 0, 'should have at least one component');
    const c = data.components[0];
    assert.ok(typeof c.lines === 'number' && c.lines > 0, 'lines should be positive');
    assert.ok(typeof c.chars === 'number' && c.chars > 0, 'chars should be positive');
    assert.ok(typeof c.estimatedTokens === 'number' && c.estimatedTokens > 0, 'estimatedTokens should be positive');
    assert.equal(c.measurement, 'shell-message', 'the hook must measure injected context, not Bash source');
    assert.match(c.label, /inactive sessions inject 0/i);
    assert.ok(c.chars < readFileSync(join(process.cwd(), 'hooks/session-start'), 'utf8').length);
    assert.match(data.note, /not a runtime session/i);
    assert.match(data.note, /inactive hook sessions emit no context/i);
    assert.ok(typeof data.totals === 'object', 'totals should be an object');
    assert.ok(data.totals.estimatedTokens > 0, 'total estimatedTokens should be positive');
  });

  it('--files filter limits output', () => {
    const out = execSync(`node "${BASELINE_PATH}" --files hooks/session-start`, { encoding: 'utf-8' });
    const data = JSON.parse(out);
    assert.equal(data.components.length, 1, 'should only have one component');
    assert.ok(data.components[0].path.includes('hooks/session-start'), 'should be the filtered file');
  });

  it('--output writes to file', () => {
    const outPath = join(TMP, 'token-baseline-test.json');
    execSync(`node "${BASELINE_PATH}" --files hooks/session-start --output "${outPath}"`, { encoding: 'utf-8' });
    const data = JSON.parse(readFileSync(outPath, 'utf-8'));
    assert.ok(data.totals.estimatedTokens > 0, 'file should contain valid data');
    unlinkSync(outPath);
  });
});

describe('token-baseline: comparison', () => {
  it('--compare produces change deltas', () => {
    const baselinePath = join(TMP, 'baseline-cmp-test.json');
    // Create a baseline with slightly different values
    const baseline = {
      timestamp: '2026-01-01T00:00:00Z',
      components: [
        { path: 'hooks/session-start', label: 'hooks/session-start', lines: 30, chars: 2000, estimatedTokens: 500 },
      ],
      totals: { lines: 30, chars: 2000, estimatedTokens: 500 },
    };
    writeFileSync(baselinePath, JSON.stringify(baseline));

    const out = execSync(`node "${BASELINE_PATH}" --files hooks/session-start --compare "${baselinePath}"`, { encoding: 'utf-8' });
    const data = JSON.parse(out);
    assert.ok(Array.isArray(data.changes), 'should have changes array');
    assert.ok(data.changes.length > 0, 'should have at least one change');
    assert.ok(typeof data.summary.totalDelta === 'number', 'should have totalDelta');
    assert.ok(typeof data.summary.totalPct === 'string', 'should have totalPct');

    unlinkSync(baselinePath);
  });

  it('missing file in baseline reports error', () => {
    const out = execSync(`node "${BASELINE_PATH}" --files hooks/session-start --compare /nonexistent/baseline.json 2>&1 || true`, { encoding: 'utf-8' });
    // Should fail gracefully — error message from file not found
    assert.ok(out.length > 0, 'should produce output even on error');
  });
});
