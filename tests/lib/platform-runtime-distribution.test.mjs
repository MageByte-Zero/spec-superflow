// Canonical skill protocol checks. Later distribution waves extend this file
// with installer and platform inventory fixtures.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PLATFORM_RUNTIME_INVENTORY, ZCODE_COMPATIBILITY_PATH } from '../../scripts/lib/platform-runtime-inventory.mjs';

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

  it('uses the portable CLI for code-review receipts without requiring a plugin-root variable', () => {
    const content = skill('code-reviewer');

    assert.doesNotMatch(content, /\$\{CLAUDE_PLUGIN_ROOT\}|\$\{PLUGIN_ROOT\}/);
    assert.match(content, new RegExp(PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('does not leave bare ssf commands in runtime instructions or reviewer templates', () => {
    const files = [
      ...RUNTIME_SKILLS.map(name => join(ROOT, 'skills', name, 'SKILL.md')),
      join(ROOT, 'skills', 'code-reviewer', 'SKILL.md'),
      join(ROOT, 'skills', 'build-executor', 'implementer-prompt.md'),
      join(ROOT, 'skills', 'build-executor', 'task-reviewer-prompt.md'),
      join(ROOT, 'skills', 'code-reviewer', 'code-reviewer-prompt.md'),
    ];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      assert.doesNotMatch(content, /`ssf\s+(?:handoff|checkpoint|execution|state|runtime|validate|doctor|config|version)\b/,
        `${file} contains a bare ssf command`);
      assert.doesNotMatch(content, /^\s*ssf\s+(?:handoff|checkpoint|execution|state|runtime|validate|doctor|config|version)\b/m,
        `${file} contains an unprefixed ssf command line`);
    }
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

describe('platform runtime inventory', () => {
  it('lists every documented platform and the ZCODE compatibility path', () => {
    const ids = new Set(PLATFORM_RUNTIME_INVENTORY.map(platform => platform.id));

    assert.deepEqual(ids, new Set([
      'claude-code', 'cursor', 'codex-cli', 'codex-app', 'copilot-cli', 'gemini-cli',
      'opencode', 'workbuddy', 'trae', 'cline', 'kiro', 'windsurf', 'qwen',
      'amazon-q', 'roocode', 'continue', 'pi',
    ]));
    assert.equal(ZCODE_COMPATIBILITY_PATH.id, 'zcode');
  });

  it('gives each documented distribution an explicit, testable runtime mode', () => {
    const validModes = new Set(['native-root', 'installer-rewrite', 'canonical-fallback']);

    for (const platform of PLATFORM_RUNTIME_INVENTORY) {
      assert.ok(platform.modes.length > 0, `${platform.id} needs at least one distribution mode`);
      for (const mode of platform.modes) assert.ok(validModes.has(mode), `${platform.id}: ${mode}`);
    }
    assert.deepEqual(ZCODE_COMPATIBILITY_PATH.modes, ['installer-rewrite']);
    assert.ok(idsWithMode('codex-cli', 'canonical-fallback'));
    assert.ok(idsWithMode('codex-app', 'canonical-fallback'));
    assert.ok(idsWithMode('opencode', 'canonical-fallback'));
  });
});

function idsWithMode(id, mode) {
  return PLATFORM_RUNTIME_INVENTORY.find(platform => platform.id === id)?.modes.includes(mode);
}
