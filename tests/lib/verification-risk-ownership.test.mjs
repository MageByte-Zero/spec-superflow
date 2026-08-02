import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHANGE_DIR = join(process.cwd(), 'changes', 'optimize-test-runtime-guidance');
const MATRIX_PATH = join(CHANGE_DIR, 'verification-risk-ownership.md');
const REQUIRED_COLUMNS = [
  '独立风险',
  '原完整链路',
  '唯一端到端所有者',
  '快速合同位置',
  '删减理由',
];

describe('verification risk ownership matrix', () => {
  it('names one end-to-end owner and a fast contract for every migrated repeated risk', () => {
    assert.equal(existsSync(MATRIX_PATH), true, 'risk ownership matrix must be recorded with the change');
    const lines = readFileSync(MATRIX_PATH, 'utf8').split('\n').filter(line => line.startsWith('|'));
    assert.deepEqual(lines[0].split('|').filter(Boolean).map(value => value.trim()), REQUIRED_COLUMNS);

    const rows = lines.slice(2).map(line => line.split('|').filter(Boolean).map(value => value.trim()));
    assert.ok(rows.length >= 4, 'matrix covers publication, report-evidence, repair-threshold, and wrapper risks');
    for (const row of rows) {
      assert.equal(row.length, REQUIRED_COLUMNS.length, `matrix row has every required field: ${row.join(' | ')}`);
      assert.ok(row.every(Boolean), `matrix row is complete: ${row.join(' | ')}`);
    }

    const owners = rows.map(row => row[2]);
    assert.equal(new Set(owners).size, owners.length, 'each migrated risk has one distinct end-to-end owner');
  });
});
