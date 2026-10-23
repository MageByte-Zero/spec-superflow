import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { readState } from '../../scripts/lib/state-loader.mjs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const read = path => readFileSync(join(root, path), 'utf8');
const primary = ['workflow-start', 'need-explorer', 'spec-writer', 'build-executor', 'bug-investigator', 'release-archivist'];

test('default skill paths disclose legacy recovery only behind recorded-state routing', () => {
  for (const name of primary) {
    const content = read(`skills/${name}/SKILL.md`);
    assert.match(content, /workflow_variant/);
    assert.match(content, /receipt `schema_version: 3`/);
    assert.match(content, /plan `schema_version: 2`/);
    assert.match(content, /legacy Quick\/Hotfix\/Lightweight can also record it/);
    assert.match(content, /Missing or corrupt.*recovery problem/);
    assert.match(content, /runtime asset read docs\/legacy-workflow\.md/);
    assert.doesNotMatch(content, /SSF (?:state (?:set|transition|init)|workflow (?:recommend|accept)|debug (?:attempt|escalate)|audit)\b/, `${name} leaks legacy commands into the default path`);
  }
  assert.doesNotMatch(read('AGENTS.md'), /No `execution-contract.md` or no user approval|Bug encountered → must enter|≤[24] files/);
});

test('legacy instructions remain available through the bundled runtime outside the repository', () => {
  const content = execFileSync(process.execPath, [join(root, 'scripts/spec-superflow.mjs'), 'runtime', 'asset', 'read', 'docs/legacy-workflow.md'], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(content, read('docs/legacy-workflow.md'));
  for (const name of primary) assert.ok(content.includes(`## ${name}`), `missing ${name} legacy recipe`);
  assert.match(content, /dp_3|contract-builder/);
  assert.match(content, /debug attempt record/);
  assert.match(content, /workflow accept.*--verification/);
  assert.match(content, /Cleanup failure remains cleanup-pending/);
});

test('a real legacy direct receipt keeps its generation visible without migrating state', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ssf-legacy-routing-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto\n');
  const cli = (...args) => execFileSync(process.execPath, [join(root, 'scripts/spec-superflow.mjs'), ...args], { encoding: 'utf8' });
  cli('workflow', 'recommend', dir, '--task-count', '2', '--file-count', '2', '--config-doc-only', 'no',
    '--schema-api-change', 'no', '--new-module', 'no', '--behavioral-constraint-change', 'no',
    '--cross-module-change', 'no', '--uncertainty', 'low', '--json');
  cli('workflow', 'accept', dir, '--source', 'direct-request', '--verification', 'bounded', '--json');
  assert.equal(readState(dir).workflow_variant, 'direct');
  const before = readFileSync(join(dir, '.spec-superflow.yaml'), 'utf8');
  const shown = JSON.parse(cli('workflow', 'show', dir, '--json'));
  assert.ok([1, 2].includes(shown.record.schema_version));
  assert.equal(shown.workflow, 'quick');
  assert.equal(shown.path, undefined, 'old direct variants must not be identified as current direct by show');
  assert.equal(readFileSync(join(dir, '.spec-superflow.yaml'), 'utf8'), before);
  assert.match(read('docs/legacy-workflow.md'), /schema 1\/2.*Quick\/Hotfix\/Lightweight.*workflow_variant: direct/s);
});
