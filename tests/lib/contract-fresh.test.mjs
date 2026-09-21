import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkContractFresh } from '../../scripts/guard/checks/contract-fresh.mjs';
import { computeArtifactsHash, computeContractHash } from '../../scripts/lib/hash.mjs';
import { rebuildState } from '../../scripts/lib/state-loader.mjs';

test('contract freshness binds both planning artifacts and the approved contract body', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ssf-contract-fresh-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'specs', 'example'), { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), '## Why\nStable intent.\n## What Changes\n- Change behavior.\n');
  writeFileSync(join(dir, 'design.md'), '# Design\nStable design.\n');
  writeFileSync(join(dir, 'tasks.md'), '# Tasks\n- [ ] 1.1 Implement.\n');
  writeFileSync(join(dir, 'specs', 'example', 'spec.md'), '### Requirement: Example\nThe system SHALL work.\n#### Scenario: Works\n- **WHEN** used\n- **THEN** it works\n');
  writeFileSync(join(dir, 'execution-contract.md'), '# Contract\nApproved body.\n');
  rebuildState(dir, { computeArtifactsHash, computeContractHash });
  assert.deepEqual(checkContractFresh(dir), { pass: true, failures: [] });

  writeFileSync(join(dir, 'execution-contract.md'), '# Contract\nChanged after approval.\n');
  const result = checkContractFresh(dir);
  assert.equal(result.pass, false);
  assert.match(result.failures.join('\n'), /changed after approval/i);
});
