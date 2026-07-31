// tests/lib/hash.test.mjs
// Tests for scripts/lib/hash.mjs
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';

let tempDir;

describe('hash: computeArtifactsHash()', () => {
  let hashMod;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-hash-test-'));
    const modulePath = join(process.cwd(), 'scripts/lib/hash.mjs');
    hashMod = await import(modulePath);
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when no artifacts exist', () => {
    const hash = hashMod.computeArtifactsHash(tempDir);
    assert.equal(hash, null);
  });

  it('computes hash from proposal.md alone', () => {
    writeFileSync(join(tempDir, 'proposal.md'), '## Why\nTest proposal content');

    const hash = hashMod.computeArtifactsHash(tempDir);
    assert.ok(hash.startsWith('sha256:'));
    assert.equal(hash.length, 64 + 7); // 'sha256:' + 64 hex chars
  });

  it('is deterministic — same content produces same hash', () => {
    const content = '## Why\nTest proposal for hash determinism';
    writeFileSync(join(tempDir, 'proposal.md'), content);

    const h1 = hashMod.computeArtifactsHash(tempDir);
    const h2 = hashMod.computeArtifactsHash(tempDir);
    assert.equal(h1, h2);
  });

  it('different content produces different hash', () => {
    writeFileSync(join(tempDir, 'proposal.md'), '## Why\nContent version A');
    const h1 = hashMod.computeArtifactsHash(tempDir);

    writeFileSync(join(tempDir, 'proposal.md'), '## Why\nContent version B');
    const h2 = hashMod.computeArtifactsHash(tempDir);

    assert.notEqual(h1, h2);
  });

  it('includes all four artifacts in hash', () => {
    writeFileSync(join(tempDir, 'proposal.md'), '## Why\nproposal content');
    mkdirSync(join(tempDir, 'specs', 'ui-theme'), { recursive: true });
    writeFileSync(join(tempDir, 'specs', 'ui-theme', 'spec.md'), '# Spec\nRequirement content');
    writeFileSync(join(tempDir, 'design.md'), '# Design\nDesign content');
    writeFileSync(join(tempDir, 'tasks.md'), '# Tasks\nTasks content');

    const h1 = hashMod.computeArtifactsHash(tempDir);

    // Change one artifact → hash should change
    writeFileSync(join(tempDir, 'design.md'), '# Design\nModified design content');
    const h2 = hashMod.computeArtifactsHash(tempDir);

    assert.notEqual(h1, h2);
  });

  it('ignores only legal task checkbox state changes', () => {
    writeFileSync(join(tempDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Keep task text\n- [X] 1.2 Keep second task\n');
    const before = hashMod.computeArtifactsHash(tempDir);

    writeFileSync(join(tempDir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 Keep task text\n- [ ] 1.2 Keep second task\n');
    const afterCheckboxOnly = hashMod.computeArtifactsHash(tempDir);
    assert.equal(afterCheckboxOnly, before);

    writeFileSync(join(tempDir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 Changed task text\n- [ ] 1.2 Keep second task\n');
    assert.notEqual(hashMod.computeArtifactsHash(tempDir), before);
  });

  it('reads canonical specs in sorted order for determinism', () => {
    mkdirSync(join(tempDir, 'specs', 'z-auth'), { recursive: true });
    mkdirSync(join(tempDir, 'specs', 'a-ui'), { recursive: true });
    writeFileSync(join(tempDir, 'proposal.md'), 'proposal');
    writeFileSync(join(tempDir, 'specs', 'z-auth', 'spec.md'), 'auth spec');
    writeFileSync(join(tempDir, 'specs', 'a-ui', 'spec.md'), 'ui spec');

    const h1 = hashMod.computeArtifactsHash(tempDir);

    // Same files, same content → same hash
    const h2 = hashMod.computeArtifactsHash(tempDir);
    assert.equal(h1, h2);
  });

  it('ignores non-.md files in specs directory', () => {
    mkdirSync(join(tempDir, 'specs', 'ui-theme'), { recursive: true });
    writeFileSync(join(tempDir, 'proposal.md'), 'proposal');
    writeFileSync(join(tempDir, 'specs', 'ui-theme', 'spec.md'), 'spec content');
    writeFileSync(join(tempDir, 'specs', 'notes.txt'), 'some notes'); // non-.md

    const h1 = hashMod.computeArtifactsHash(tempDir);

    // Change non-.md file → hash should NOT change
    writeFileSync(join(tempDir, 'specs', 'notes.txt'), 'modified notes');
    const h2 = hashMod.computeArtifactsHash(tempDir);

    assert.equal(h1, h2);
  });
});

describe('hash: computeContractHash()', () => {
  let hashMod;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-hash-contract-'));
    const modulePath = join(process.cwd(), 'scripts/lib/hash.mjs');
    hashMod = await import(modulePath);
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when execution-contract.md does not exist', () => {
    const hash = hashMod.computeContractHash(tempDir);
    assert.equal(hash, null);
  });

  it('computes hash of execution-contract.md', () => {
    writeFileSync(join(tempDir, 'execution-contract.md'), '## Intent Lock\nContract content');

    const hash = hashMod.computeContractHash(tempDir);
    assert.ok(hash.startsWith('sha256:'));
    assert.equal(hash.length, 64 + 7);
  });

  it('is independent of artifacts hash', () => {
    writeFileSync(join(tempDir, 'execution-contract.md'), 'contract v1');
    writeFileSync(join(tempDir, 'proposal.md'), 'proposal v1');

    const contractHash = hashMod.computeContractHash(tempDir);
    const artifactsHash = hashMod.computeArtifactsHash(tempDir);

    assert.notEqual(contractHash, artifactsHash);
  });
});
