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
import { installPlatform } from '../../scripts/lib/install.mjs';

const ROOT = process.cwd();
const CLI = join(ROOT, 'scripts', 'spec-superflow.mjs');
const SOURCE_RUNTIME_COMMAND = 'ssf';
const FIXED_NPM_RUNTIME = /npx --yes --package spec-superflow@\d+\.\d+\.\d+ ssf/;
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

  it('uses the unversioned local CLI for every runtime-dependent source skill', () => {
    for (const name of RUNTIME_SKILLS) {
      const content = skill(name);
      assert.match(content, new RegExp(`\\b${SOURCE_RUNTIME_COMMAND}\\s+`),
        `${name} should use the source runtime command`);
      assert.doesNotMatch(content, FIXED_NPM_RUNTIME,
        `${name} should not pin an npm runtime version`);
      assert.doesNotMatch(content, /\$\{CLAUDE_PLUGIN_ROOT\}|\$\{PLUGIN_ROOT\}/,
        `${name} should not require a host plugin-root variable`);
    }
  });

  it('uses the unversioned local CLI for each recovery command source asset', () => {
    for (const name of ['resume', 'switch', 'save']) {
      const content = readFileSync(join(ROOT, 'commands', 'ssf', `${name}.md`), 'utf8');
      assert.match(content, new RegExp(`\\b${SOURCE_RUNTIME_COMMAND}\\s+`),
        `${name} should use the source runtime command`);
      assert.doesNotMatch(content, FIXED_NPM_RUNTIME,
        `${name} should not pin an npm runtime version`);
    }
  });

  it('uses allowlisted runtime assets for build-executor prompts', () => {
    const content = skill('build-executor');

    assert.match(content, /runtime asset read skills\/build-executor\/implementer-prompt\.md/);
    assert.match(content, /runtime asset read skills\/build-executor\/task-reviewer-prompt\.md/);
  });

  it('keeps the source command unversioned so npm link resolves the live checkout', () => {
    for (const name of RUNTIME_SKILLS) {
      assert.match(skill(name), /\bssf\s+(?:audit|checkpoint|config|execution|handoff|inject|isolate|runtime|state|sync|workflow)\b/);
    }
  });
});

describe('local runtime deployment', () => {
  it('writes four-mode phase guards through the Cursor and shared installers', async () => {
    const cursorTarget = mkdtempSync(join(tmpdir(), 'ssf-cursor-guard-'));
    const sharedTarget = mkdtempSync(join(tmpdir(), 'ssf-shared-guard-'));
    try {
      execFileSync(process.execPath, [join(ROOT, 'scripts', 'install-cursor.mjs'), '--local', ROOT], {
        cwd: cursorTarget,
        stdio: 'pipe',
      });
      await installPlatform('cline', { local: ROOT, cwd: sharedTarget });

      const guards = [
        readFileSync(join(cursorTarget, '.cursor', 'rules', 'phase-guard.mdc'), 'utf8'),
        readFileSync(join(sharedTarget, '.clinerules', 'phase-guard.md'), 'utf8'),
      ];
      for (const guard of guards) {
        assert.match(guard, /Full 或 legacy Hotfix/);
        assert.match(guard, /Quick、direct Hotfix、tweak/);
        assert.match(guard, /test_result: pass/);
      }
    } finally {
      rmSync(cursorTarget, { recursive: true, force: true });
      rmSync(sharedTarget, { recursive: true, force: true });
    }
  });

  it('rewrites the source runtime command to ZCODE\'s installed runtime tree', () => {
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
      assert.doesNotMatch(content, new RegExp(`\\b${SOURCE_RUNTIME_COMMAND}\\s+`));
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
      const command = content.match(/node '([^']+)' runtime asset read docs\/state-machine\.md/);
      assert.ok(command, 'workflow-start should contain a shell-literal local runtime command');

      const runtimeScript = command[1];
      assert.equal(runtimeScript, join(realpathSync(join(target, '.zcode', 'spec-superflow')), 'scripts', 'spec-superflow.mjs'));
      const output = execFileSync(process.execPath, [runtimeScript, 'runtime', 'asset', 'read', 'docs/state-machine.md'], {
        cwd: target,
        encoding: 'utf8',
      });
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
  it('does not version source runtime commands during a release dry-run', () => {
    const output = execFileSync(process.execPath, [CLI, 'version', '2.0.0', '--dry-run'], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    assert.doesNotMatch(output, /skills\/code-reviewer\/SKILL\.md: version string updated/);
    assert.doesNotMatch(output, /skills\/build-executor\/implementer-prompt\.md: version string updated/);
    assert.doesNotMatch(output, /skills\/build-executor\/task-reviewer-prompt\.md: version string updated/);
    assert.doesNotMatch(output, /skills\/code-reviewer\/code-reviewer-prompt\.md: version string updated/);
    assert.match(output, /README\.md: version string updated/);
    assert.match(output, /INSTALL\.md: version string updated/);
    assert.match(output, /hooks\/session-start: version string updated/);
  });

  it('updates npm lock metadata without rewriting source recovery commands', () => {
    const target = mkdtempSync(join(tmpdir(), 'ssf-version-release-assets-'));
    try {
      mkdirSync(join(target, 'commands', 'ssf'), { recursive: true });
      mkdirSync(join(target, 'docs'), { recursive: true });
      mkdirSync(join(target, 'hooks'), { recursive: true });
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
          `Run \`${SOURCE_RUNTIME_COMMAND} ${name}\`.\n`,
        );
      }
      writeFileSync(join(target, 'README.md'), '当前版本：`v0.10.0`\n');
      writeFileSync(join(target, 'INSTALL.md'), '当前发布版本：**v0.10.0**。\n');
      writeFileSync(join(target, 'docs', 'README_en.md'), 'Current: `v0.10.0`\n');
      writeFileSync(join(target, 'hooks', 'session-start'), '# v0.10.0: conditional injection\n');
      writeFileSync(join(target, 'llms.txt'), 'Current version: v0.10.0.\n');

      execFileSync(process.execPath, [CLI, 'version', '1.0.0'], {
        cwd: target,
        encoding: 'utf8',
      });

      const lock = JSON.parse(readFileSync(join(target, 'package-lock.json'), 'utf8'));
      assert.equal(lock.version, '1.0.0');
      assert.equal(lock.packages[''].version, '1.0.0');
      assert.equal(readFileSync(join(target, 'README.md'), 'utf8'), '当前版本：`v1.0.0`\n');
      assert.equal(readFileSync(join(target, 'INSTALL.md'), 'utf8'), '当前发布版本：**v1.0.0**。\n');
      assert.equal(readFileSync(join(target, 'docs', 'README_en.md'), 'utf8'), 'Current: `v1.0.0`\n');
      assert.equal(readFileSync(join(target, 'hooks', 'session-start'), 'utf8'), '# v1.0.0: conditional injection\n');
      assert.equal(readFileSync(join(target, 'llms.txt'), 'utf8'), 'Current version: v1.0.0.\n');
      for (const name of ['resume', 'switch', 'save']) {
        assert.match(
          readFileSync(join(target, 'commands', 'ssf', `${name}.md`), 'utf8'),
          new RegExp(`${SOURCE_RUNTIME_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${name}`),
        );
      }
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('reports npm lock metadata drift without requiring source runtime command pins', () => {
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
      writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
      const result = spawnSync(process.execPath, [join(fixture, 'scripts', 'check-version-consistency.mjs')], {
        cwd: fixture,
        encoding: 'utf8',
      });
      const output = `${result.stdout}${result.stderr}`;

      assert.equal(result.status, 1);
      assert.match(output, /package-lock\.json \[version\]/);
      assert.match(output, /package-lock\.json \[packages\.\.version\]/);
      assert.doesNotMatch(output, /commands\/ssf\/(?:resume|switch|save)\.md/);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});

function idsWithMode(id, mode) {
  return PLATFORM_RUNTIME_INVENTORY.find(platform => platform.id === id)?.modes.includes(mode);
}
