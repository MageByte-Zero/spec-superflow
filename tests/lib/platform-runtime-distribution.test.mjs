// Canonical skill protocol checks. Later distribution waves extend this file
// with installer and platform inventory fixtures.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  'code-reviewer',
  'bug-investigator',
  'release-archivist',
  'spec-merger',
];

function skill(name) {
  return readFileSync(join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
}

describe('canonical skill runtime protocol', () => {
  it('publishes four-mode direct-path rules in generated Cursor and ZCODE assets', () => {
    for (const path of ['scripts/install-cursor.mjs', 'scripts/install-zcode.mjs']) {
      const content = readFileSync(join(ROOT, path), 'utf8');
      assert.match(content, /Quick、direct Hotfix、tweak/);
      assert.match(content, /Full 或 legacy Hotfix/);
      assert.match(content, /test_result: pass/);
    }
  });

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

  it('does not leave bare ssf commands in runtime instructions or reviewer templates', () => {
    const files = [
      ...RUNTIME_SKILLS.map(name => join(ROOT, 'skills', name, 'SKILL.md')),
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
      const localPrefix = `node '${join(realpathSync(pluginRoot), 'scripts', 'spec-superflow.mjs')}'`;

      assert.match(content, new RegExp(localPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(content, new RegExp(PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('emits a shell-literal local runtime command when the target path contains a dollar sign', () => {
    const target = mkdtempSync(join(tmpdir(), 'ssf-$runtime-'));
    try {
      execFileSync(process.execPath, [CLI, 'install-zcode', '--local', ROOT], {
        cwd: target,
        stdio: 'pipe',
      });

      const content = readFileSync(join(target, '.zcode', 'skills', 'workflow-start', 'SKILL.md'), 'utf8');
      const command = content.match(/node '[^']+' runtime asset read docs\/state-machine\.md/);
      assert.ok(command, 'workflow-start should contain a shell-literal local runtime command');

      const output = execFileSync('sh', ['-c', command[0]], { cwd: target, encoding: 'utf8' });
      assert.match(output, /State Machine/);
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

describe('runtime version synchronization', () => {
  it('includes code-reviewer when a release version is dry-run', () => {
    const output = execFileSync(process.execPath, [CLI, 'version', '0.9.2', '--dry-run'], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    assert.match(output, /skills\/code-reviewer\/SKILL\.md: version string updated/);
    assert.match(output, /skills\/build-executor\/implementer-prompt\.md: version string updated/);
    assert.match(output, /skills\/build-executor\/task-reviewer-prompt\.md: version string updated/);
    assert.match(output, /skills\/code-reviewer\/code-reviewer-prompt\.md: version string updated/);
  });

  it('updates npm lock metadata and recovery command runtime pins', () => {
    const target = mkdtempSync(join(tmpdir(), 'ssf-version-release-assets-'));
    try {
      mkdirSync(join(target, 'commands', 'ssf'), { recursive: true });
      writeFileSync(join(target, 'package.json'), '{"name":"fixture","version":"0.10.0"}\n');
      writeFileSync(join(target, 'package-lock.json'), `${JSON.stringify({
        name: 'fixture',
        version: '0.10.0',
        lockfileVersion: 3,
        packages: { '': { name: 'fixture', version: '0.10.0' } },
      }, null, 2)}\n`);
      for (const name of ['resume', 'switch', 'save']) {
        writeFileSync(
          join(target, 'commands', 'ssf', `${name}.md`),
          `Run \`npx --yes --package spec-superflow@0.10.0 ssf ${name}\`.\n`,
        );
      }

      execFileSync(process.execPath, [CLI, 'version', '0.11.0'], {
        cwd: target,
        encoding: 'utf8',
      });

      const lock = JSON.parse(readFileSync(join(target, 'package-lock.json'), 'utf8'));
      assert.equal(lock.version, '0.11.0');
      assert.equal(lock.packages[''].version, '0.11.0');
      for (const name of ['resume', 'switch', 'save']) {
        assert.match(
          readFileSync(join(target, 'commands', 'ssf', `${name}.md`), 'utf8'),
          new RegExp(`spec-superflow@0\\.11\\.0 ssf ${name}`),
        );
      }
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('reports drift in npm lock metadata and recovery command runtime pins', () => {
    const target = mkdtempSync(join(tmpdir(), 'ssf-version-consistency-'));
    const fixture = join(target, 'repo');
    try {
      cpSync(ROOT, fixture, {
        recursive: true,
        filter(source) {
          const relative = source.slice(ROOT.length).replace(/^\//, '');
          return relative !== '.git' && !relative.startsWith('.git/')
            && !relative.startsWith('node_modules')
            && !relative.startsWith('changes')
            && !relative.startsWith('.superpowers');
        },
      });
      const lockPath = join(fixture, 'package-lock.json');
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      lock.version = '9.9.9';
      lock.packages[''].version = '9.9.9';
      writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
      for (const name of ['resume', 'switch', 'save']) {
        const path = join(fixture, 'commands', 'ssf', `${name}.md`);
        writeFileSync(path, readFileSync(path, 'utf8').replace(/spec-superflow@\d+\.\d+\.\d+/g, 'spec-superflow@9.9.9'));
      }

      const result = spawnSync(process.execPath, [join(fixture, 'scripts', 'check-version-consistency.mjs')], {
        cwd: fixture,
        encoding: 'utf8',
      });
      const output = `${result.stdout}${result.stderr}`;

      assert.equal(result.status, 1);
      assert.match(output, /package-lock\.json \[version\]/);
      assert.match(output, /package-lock\.json \[packages\.\.version\]/);
      for (const name of ['resume', 'switch', 'save']) {
        assert.match(output, new RegExp(`commands/ssf/${name}\\.md`));
      }
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});

function idsWithMode(id, mode) {
  return PLATFORM_RUNTIME_INVENTORY.find(platform => platform.id === id)?.modes.includes(mode);
}
