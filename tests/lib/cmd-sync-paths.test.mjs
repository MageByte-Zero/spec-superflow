import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deriveCapabilityDir } from '../../scripts/lib/cmd-sync.mjs';

const CLI = join(process.cwd(), 'scripts/spec-superflow.mjs');
let tempRoot;

function runSync(cwd, changeDir) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'sync', changeDir], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      exitCode: err.status || 1,
      stdout: err.stdout?.toString() || '',
      stderr: err.stderr?.toString() || err.message,
    };
  }
}

function writeSpec(file, content) {
  writeFileSync(file, content);
}

function requirement(name, text = name) {
  return `### Requirement: ${name}\n\nThe system SHALL ${text}.\n\n#### Scenario: ${name}\n- **WHEN** sync runs\n- **THEN** ${text}.`;
}

function writeChangeState(change) {
  writeFileSync(join(change, '.spec-superflow.yaml'), 'state: executing\nworkflow: full\nchange_name: canonical\n');
}

describe('cmd-sync: canonical spec publication', () => {
  before(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'ssf-sync-paths-'));
  });

  after(() => {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  });

  it('applies ADDED requirements to an existing canonical baseline and writes a receipt', () => {
    const repo = mkdtempSync(join(tempRoot, 'repo-'));
    const change = join(repo, 'changes', 'canonical');
    mkdirSync(join(change, 'specs', 'ui-theme'), { recursive: true });
    mkdirSync(join(repo, 'specs', 'ui-theme'), { recursive: true });
    writeChangeState(change);
    writeSpec(join(repo, 'specs', 'ui-theme', 'spec.md'), `# UI Theme\n\n## Requirements\n\n${requirement('Existing', 'keep existing behavior')}\n`);
    writeSpec(join(change, 'specs', 'ui-theme', 'spec.md'), `# UI Theme delta\n\n## ADDED Requirements\n\n${requirement('Sync path', 'publish canonical paths')}\n`);

    const result = runSync(repo, change);
    const baseline = readFileSync(join(repo, 'specs', 'ui-theme', 'spec.md'), 'utf-8');
    const state = readFileSync(join(change, '.spec-superflow.yaml'), 'utf-8');

    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.match(baseline, /^## Requirements$/m);
    assert.match(baseline, /Requirement: Existing/);
    assert.match(baseline, /Requirement: Sync path/);
    assert.doesNotMatch(baseline, /^## ADDED Requirements$/m);
    assert.match(state, /^spec_publication_receipt: [A-Za-z0-9_-]+$/m);
  });

  it('applies MODIFIED, REMOVED, RENAMED, and ADDED operations without persisting delta headers', () => {
    const repo = mkdtempSync(join(tempRoot, 'repo-operations-'));
    const change = join(repo, 'changes', 'operations');
    mkdirSync(join(change, 'specs', 'workflow'), { recursive: true });
    mkdirSync(join(repo, 'specs', 'workflow'), { recursive: true });
    writeChangeState(change);
    writeSpec(join(repo, 'specs', 'workflow', 'spec.md'), `# Workflow\n\n## Requirements\n\n${requirement('Keep', 'keep behavior')}\n\n${requirement('Modify me', 'old behavior')}\n\n${requirement('Remove me', 'remove behavior')}\n\n${requirement('Rename me', 'rename behavior')}\n`);
    writeSpec(join(change, 'specs', 'workflow', 'spec.md'), `## ADDED Requirements\n\n${requirement('Added', 'add behavior')}\n\n## MODIFIED Requirements\n\n${requirement('Modify me', 'new behavior')}\n\n## REMOVED Requirements\n\n### Requirement: Remove me\n\n## RENAMED Requirements\n\n- FROM: \`### Requirement: Rename me\`\n- TO: \`### Requirement: Renamed\`\n`);

    const result = runSync(repo, change);
    const baseline = readFileSync(join(repo, 'specs', 'workflow', 'spec.md'), 'utf-8');

    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.match(baseline, /Requirement: Keep/);
    assert.match(baseline, /Requirement: Added/);
    assert.match(baseline, /Requirement: Modify me[\s\S]*new behavior/);
    assert.doesNotMatch(baseline, /old behavior/);
    assert.doesNotMatch(baseline, /Requirement: Remove me/);
    assert.match(baseline, /Requirement: Renamed/);
    assert.doesNotMatch(baseline, /Requirement: Rename me/);
    assert.doesNotMatch(baseline, /^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements$/m);
  });

  it('normalizes a legacy copied delta baseline before publishing the next delta', () => {
    const repo = mkdtempSync(join(tempRoot, 'repo-legacy-'));
    const change = join(repo, 'changes', 'legacy');
    mkdirSync(join(change, 'specs', 'workflow'), { recursive: true });
    mkdirSync(join(repo, 'specs', 'workflow'), { recursive: true });
    writeChangeState(change);
    writeSpec(join(repo, 'specs', 'workflow', 'spec.md'), `# Workflow\n\n## ADDED Requirements\n\n${requirement('Legacy', 'keep migrated behavior')}\n`);
    writeSpec(join(change, 'specs', 'workflow', 'spec.md'), `## ADDED Requirements\n\n${requirement('Current', 'publish current behavior')}\n`);

    const result = runSync(repo, change);
    const baseline = readFileSync(join(repo, 'specs', 'workflow', 'spec.md'), 'utf-8');

    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.match(baseline, /^## Requirements$/m);
    assert.match(baseline, /Requirement: Legacy/);
    assert.match(baseline, /Requirement: Current/);
    assert.doesNotMatch(baseline, /^## ADDED Requirements$/m);
  });

  it('derives the published baseline from the change path rather than the caller cwd', () => {
    const repo = mkdtempSync(join(tempRoot, 'repo-context-'));
    const change = join(repo, 'changes', 'context');
    mkdirSync(join(change, 'specs', 'workflow'), { recursive: true });
    writeSpec(join(change, 'specs', 'workflow', 'spec.md'), `## ADDED Requirements\n\n${requirement('Context', 'resolve its project root')}\n`);

    const result = runSync(tempRoot, change);

    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(existsSync(join(repo, 'specs', 'workflow', 'spec.md')), true);
    assert.equal(existsSync(join(tempRoot, 'specs', 'workflow', 'spec.md')), false);
  });

  it('ignores closing and state-less historical changes during conflict detection', () => {
    const repo = mkdtempSync(join(tempRoot, 'repo-active-conflicts-'));
    const change = join(repo, 'changes', 'active');
    const closing = join(repo, 'changes', 'closed');
    const historical = join(repo, 'changes', 'historical-copy');
    for (const dir of [change, closing, historical]) mkdirSync(join(dir, 'specs', 'workflow'), { recursive: true });
    writeChangeState(change);
    writeFileSync(join(closing, '.spec-superflow.yaml'), 'state: closing\nworkflow: full\n');
    writeSpec(join(change, 'specs', 'workflow', 'spec.md'), `## ADDED Requirements\n\n${requirement('Active', 'publish active behavior')}\n`);
    const staleDelta = `## MODIFIED Requirements\n\n${requirement('Stale', 'conflicting historical behavior')}\n`;
    writeSpec(join(closing, 'specs', 'workflow', 'spec.md'), staleDelta);
    writeSpec(join(historical, 'specs', 'workflow', 'spec.md'), staleDelta);

    const result = runSync(repo, change);

    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    assert.equal(existsSync(join(repo, 'specs', 'workflow', 'spec.md')), true);
  });

  it('derives capability dirs from Windows-style spec paths', () => {
    assert.equal(
      deriveCapabilityDir('C:\\repo\\changes\\feature\\specs', 'C:\\repo\\changes\\feature\\specs\\ui-theme\\spec.md'),
      'ui-theme',
    );
  });

  it('rejects flat specs before syncing', () => {
    const repo = mkdtempSync(join(tempRoot, 'repo-flat-'));
    const change = join(repo, 'changes', 'flat');
    mkdirSync(join(change, 'specs'), { recursive: true });
    writeSpec(join(change, 'specs', 'ui-theme.md'), `## ADDED Requirements\n\n${requirement('Flat')}`);

    const result = runSync(repo, change);
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout + result.stderr, /Invalid spec path: specs\/ui-theme\.md/);
    assert.equal(existsSync(join(repo, 'specs', 'ui-theme', 'spec.md')), false);
  });

  it('rejects root specs/spec.md before syncing', () => {
    const repo = mkdtempSync(join(tempRoot, 'repo-root-'));
    const change = join(repo, 'changes', 'root-spec');
    mkdirSync(join(change, 'specs'), { recursive: true });
    writeSpec(join(change, 'specs', 'spec.md'), `## ADDED Requirements\n\n${requirement('Root')}`);

    const result = runSync(repo, change);
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout + result.stderr, /Invalid spec path: specs\/spec\.md/);
    assert.equal(existsSync(join(repo, 'specs', 'spec.md')), false);
  });
});
