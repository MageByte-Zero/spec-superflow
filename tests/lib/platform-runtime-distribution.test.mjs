// Canonical skill protocol checks. Later distribution waves extend this file
// with installer and platform inventory fixtures.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const PREFIX = `npx --yes --package spec-superflow@${VERSION} ssf`;
const CLI = join(ROOT, 'scripts', 'spec-superflow.mjs');
const RUNTIME_SKILLS = [
  'workflow-start',
  'need-explorer',
  'spec-writer',
  'contract-builder',
  'build-executor',
  'bug-investigator',
  'release-archivist',
  'spec-merger',
];

function skill(name) {
  return readFileSync(join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
}

describe('canonical skill runtime protocol', () => {
  it('uses the exact package-version prefix for every runtime-dependent skill', () => {
    for (const name of RUNTIME_SKILLS) {
      const content = skill(name);
      assert.match(content, new RegExp(PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `${name} should use the canonical portable prefix`);
      assert.doesNotMatch(content, /\$\{CLAUDE_PLUGIN_ROOT\}|\$\{PLUGIN_ROOT\}/,
        `${name} should not require a host plugin-root variable`);
    }
  });

  it('uses allowlisted runtime assets for build-executor prompts', () => {
    const content = skill('build-executor');

    assert.match(content, /runtime asset read skills\/build-executor\/implementer-prompt\.md/);
    assert.match(content, /runtime asset read skills\/build-executor\/task-reviewer-prompt\.md/);
  });

  it('keeps code-reviewer explicitly free of portable runtime commands', () => {
    const content = skill('code-reviewer');

    assert.doesNotMatch(content, /\$\{CLAUDE_PLUGIN_ROOT\}|\$\{PLUGIN_ROOT\}/);
    assert.doesNotMatch(content, /spec-superflow@\d+\.\d+\.\d+/);
  });
});

describe('local runtime deployment', () => {
  it('rewrites the canonical prefix to ZCODE\'s installed runtime tree', () => {
    const target = mkdtempSync(join(tmpdir(), 'ssf-zcode-runtime-'));
    try {
      execFileSync(process.execPath, [CLI, 'install-zcode', '--local', ROOT], {
        cwd: target,
        stdio: 'pipe',
      });

      const pluginRoot = join(target, '.zcode', 'spec-superflow');
      const content = readFileSync(join(target, '.zcode', 'skills', 'workflow-start', 'SKILL.md'), 'utf8');
      const localPrefix = `node "${join(realpathSync(pluginRoot), 'scripts', 'spec-superflow.mjs')}"`;

      assert.match(content, new RegExp(localPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(content, new RegExp(PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});
