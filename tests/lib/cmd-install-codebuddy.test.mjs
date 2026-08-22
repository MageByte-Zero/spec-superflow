// tests/lib/cmd-install-codebuddy.test.mjs
// Tests for scripts/lib/cmd-install-codebuddy.mjs and cmd-uninstall-codebuddy.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

// Windows-safe dynamic import: bare Windows paths (D:\...) are not valid ESM
// import specifiers, so convert to a file:// URL. No-op on POSIX.
async function loadModule(relPath) {
  return import(pathToFileURL(join(process.cwd(), relPath)).href);
}

let tempDir;
let planInstall, installCodeBuddy, planUninstall, uninstallCodeBuddy;

// The install/uninstall flow may call applyPathEntry to mutate the real user
// PATH; tests must inject a no-op so the host environment is never touched.
const noopApplyPath = async ({ action }) => ({ applied: false, detail: `${action}: no-op (test)` });

describe('cmd-install-codebuddy', () => {
  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-codebuddy-'));
    const installMod = await loadModule('scripts/lib/cmd-install-codebuddy.mjs');
    planInstall = installMod.planInstall;
    installCodeBuddy = installMod.installCodeBuddy;
    const uninstallMod = await loadModule('scripts/lib/cmd-uninstall-codebuddy.mjs');
    planUninstall = uninstallMod.planUninstall;
    uninstallCodeBuddy = uninstallMod.uninstallCodeBuddy;
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  // Build a minimal plugin root with the canonical command tree and 2 skills.
  // The command files use the real npx form so the rewrite is exercised.
  function makePluginRoot({ skills = ['workflow-start', 'need-explorer'], commands = ['resume', 'save', 'switch'] } = {}) {
    const pluginRoot = join(tempDir, 'spec-superflow');
    const skillsDir = join(pluginRoot, 'skills');
    for (const name of skills) {
      mkdirSync(join(skillsDir, name), { recursive: true });
      // workflow-start carries an npx invocation so the install rewrite is exercised.
      const body = name === 'workflow-start'
        ? `---\nname: ${name}\n---\nRun \`npx --yes --package spec-superflow@0.12.1 ssf state init <change-dir>\`\n`
        : `---\nname: ${name}\n---\n`;
      writeFileSync(join(skillsDir, name, 'SKILL.md'), body);
    }
    for (const command of commands) {
      const commandFile = join(pluginRoot, 'commands', 'ssf', `${command}.md`);
      mkdirSync(join(commandFile, '..'), { recursive: true });
      writeFileSync(commandFile, `---\n\ndescription: ${command} command\nargument-hint: "<change>"\nallowed-tools: Bash(ssf:*)\n---\n\nRun \`ssf ${command} --json "$ARGUMENTS"\` and report.\n`);
    }
    writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ version: '0.12.1' }));
    // A scripts/ dir so RUNTIME_DIRS copy has at least one file.
    mkdirSync(join(pluginRoot, 'scripts'), { recursive: true });
    writeFileSync(join(pluginRoot, 'scripts', 'spec-superflow.mjs'), '// test runtime entry');
    return pluginRoot;
  }

  it('plans CodeBuddy paths with settings.json (not hooks.json)', () => {
    const pluginRoot = makePluginRoot();
    const plan = planInstall({ pluginRoot, configDir: join(tempDir, 'cb') });
    assert.equal(plan.settingsPath, join(tempDir, 'cb', 'settings.json'));
    assert.equal(plan.targetPluginDir, join(tempDir, 'cb', 'spec-superflow'));
    assert.equal(plan.targetCommands, join(tempDir, 'cb', 'commands'));
    assert.deepEqual(plan.commandNames, ['ssf:resume', 'ssf:save', 'ssf:switch']);
    assert.equal(plan.sessionStartScript, join(plan.targetPluginDir, 'hooks', 'session-start'));
  });

  it('deploys skills, runtime, rules, and merges SessionStart into settings.json', async () => {
    const pluginRoot = makePluginRoot();
    const configDir = join(tempDir, 'cb');
    await installCodeBuddy({ pluginRoot, configDir, applyPath: noopApplyPath });

    // skills
    assert.ok(existsSync(join(configDir, 'skills', 'workflow-start', 'SKILL.md')));
    assert.ok(existsSync(join(configDir, 'skills', 'need-explorer', 'SKILL.md')));

    // runtime copied
    assert.ok(existsSync(join(configDir, 'spec-superflow', 'scripts', 'spec-superflow.mjs')));

    // settings.json with SessionStart pointing at deployed hook
    const settings = JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf-8'));
    const ssfEntry = settings.hooks.SessionStart.find(e =>
      Array.isArray(e.hooks) && e.hooks.some(h => h.command && h.command.includes('spec-superflow')),
    );
    assert.ok(ssfEntry, 'expected a spec-superflow SessionStart entry');
    assert.match(ssfEntry.hooks[0].command, /bash .+spec-superflow\/hooks\/session-start/);

    // phase-guard rule with alwaysApply:false frontmatter
    const phaseGuard = readFileSync(join(configDir, 'rules', 'phase-guard.md'), 'utf-8');
    assert.match(phaseGuard, /^---\nalwaysApply: false\n---/);

    // user-level hooks.json must NOT be written (CodeBuddy does not load it)
    assert.ok(!existsSync(join(configDir, 'hooks', 'hooks.json')));
  });

  it('generates ssf command shims in the bin dir on install', async () => {
    const pluginRoot = makePluginRoot();
    const configDir = join(tempDir, 'cb');
    await installCodeBuddy({ pluginRoot, configDir, applyPath: noopApplyPath });

    const binDir = join(configDir, 'spec-superflow', 'bin');
    const posixShim = readFileSync(join(binDir, 'ssf'), 'utf-8');
    assert.ok(posixShim.startsWith('#!/bin/sh'));
    assert.match(posixShim, /exec node .+spec-superflow\.mjs/);
    assert.match(posixShim, /\$@/);

    const cmdShim = readFileSync(join(binDir, 'ssf.cmd'), 'utf-8');
    assert.ok(cmdShim.startsWith('@ECHO off'));
    assert.match(cmdShim, /node .+spec-superflow\.mjs/);
    assert.match(cmdShim, /%*/);

    const psShim = readFileSync(join(binDir, 'ssf.ps1'), 'utf-8');
    assert.match(psShim, /node .+spec-superflow\.mjs/);
    assert.match(psShim, /\$args/);
  });

  it('registers the bin dir on PATH by default and skips with --no-path', async () => {
    const pluginRoot = makePluginRoot();
    const calls = [];
    const recordingApplyPath = async (opts) => {
      calls.push(opts);
      return { applied: true, detail: 'recorded' };
    };

    const configDir = join(tempDir, 'cb');
    await installCodeBuddy({ pluginRoot, configDir, applyPath: recordingApplyPath });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'add');
    assert.equal(calls[0].binDir, join(configDir, 'spec-superflow', 'bin'));

    // --no-path: shims are written but applyPath is never invoked.
    const configDir2 = join(tempDir, 'cb2');
    await installCodeBuddy({ pluginRoot, configDir: configDir2, noPath: true, applyPath: recordingApplyPath });
    assert.equal(calls.length, 1, '--no-path must not call applyPath');
    assert.ok(existsSync(join(configDir2, 'spec-superflow', 'bin', 'ssf.cmd')), 'shims still written with --no-path');
  });

  it('run --dry-run writes nothing to disk', async () => {
    const pluginRoot = makePluginRoot();
    const configDir = join(tempDir, 'cb-dry');
    const mod = await loadModule('scripts/lib/cmd-install-codebuddy.mjs');
    await mod.run(['--dry-run', '--local', pluginRoot, '--config-dir', configDir]);
    assert.ok(!existsSync(configDir), 'dry-run must not create the config dir');
  });

  it('rewrites --local recovery commands to use the deployed local runtime', async () => {
    const pluginRoot = makePluginRoot();
    const configDir = join(tempDir, 'cb');
    await installCodeBuddy({ pluginRoot, configDir, applyPath: noopApplyPath });

    for (const name of ['resume', 'save', 'switch']) {
      const content = readFileSync(join(configDir, 'commands', 'ssf', `${name}.md`), 'utf-8');
      // npx --package is gone
      assert.doesNotMatch(content, /npx --yes --package spec-superflow@\d+\.\d+\.\d+ ssf/);
      // replaced by node calling the deployed spec-superflow.mjs runtime, then the subcommand
      assert.match(content, /node .+spec-superflow[\\/]+scripts[\\/]+spec-superflow\.mjs/);
      assert.match(content, new RegExp(`${name} --json`));
      // allowed-tools switched from npx to node
      assert.match(content, /allowed-tools: Bash\(node:\*\)/);
      assert.doesNotMatch(content, /Bash\((?:npx|ssf):\*\)/);
    }
  });

  it('rewrites npx invocations in deployed skills to use the local runtime', async () => {
    const pluginRoot = makePluginRoot();
    const configDir = join(tempDir, 'cb');
    await installCodeBuddy({ pluginRoot, configDir, applyPath: noopApplyPath });
    const skillMd = readFileSync(join(configDir, 'skills', 'workflow-start', 'SKILL.md'), 'utf-8');
    // Source SKILL.md used npx --yes --package spec-superflow@0.12.1 ssf; deployed must use node <pluginRoot>/scripts/spec-superflow.mjs
    assert.doesNotMatch(skillMd, /npx --yes --package spec-superflow@\d+\.\d+\.\d+ ssf/);
    assert.match(skillMd, /node .+spec-superflow[\\/]+scripts[\\/]+spec-superflow\.mjs/);
  });

  it('rewrites bare ssf subcommand invocations in deployed skills to the local runtime', async () => {
    const pluginRoot = makePluginRoot();
    // Real skill sources use a bare `ssf <subcommand>` (no npx); the deployed
    // skill must not depend on a globally linked `ssf` (e.g. under --no-path).
    writeFileSync(join(pluginRoot, 'skills', 'workflow-start', 'SKILL.md'),
      '---\nname: workflow-start\n---\nRun `ssf state init <change-dir>`.\n');
    const configDir = join(tempDir, 'cb');
    await installCodeBuddy({ pluginRoot, configDir, applyPath: noopApplyPath });
    const skillMd = readFileSync(join(configDir, 'skills', 'workflow-start', 'SKILL.md'), 'utf-8');
    assert.doesNotMatch(skillMd, /\bssf state init\b/);
    assert.match(skillMd, /node .+spec-superflow[\\/]+scripts[\\/]+spec-superflow\.mjs/);
    assert.match(skillMd, /state init/);
  });

  it('preserves existing settings.json fields and non-ssf SessionStart hooks', async () => {
    const pluginRoot = makePluginRoot();
    const configDir = join(tempDir, 'cb');
    mkdirSync(configDir, { recursive: true });
    const existing = {
      permissions: { allow: ['Read'], deny: ['Read(./.env)'] },
      enabledPlugins: { 'other@market': true },
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo user-start' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }],
      },
    };
    writeFileSync(join(configDir, 'settings.json'), JSON.stringify(existing, null, 2));

    await installCodeBuddy({ pluginRoot, configDir, applyPath: noopApplyPath });

    const settings = JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf-8'));
    // other top-level fields preserved
    assert.deepEqual(settings.permissions, existing.permissions);
    assert.equal(settings.enabledPlugins['other@market'], true);
    // other event types preserved
    assert.ok(settings.hooks.PreToolUse);
    // non-ssf SessionStart entry preserved
    const userEntries = settings.hooks.SessionStart.filter(e =>
      Array.isArray(e.hooks) && e.hooks.every(h => !h.command.includes('spec-superflow')),
    );
    assert.equal(userEntries.length, 1);
    // ssf SessionStart entry present
    const ssfEntries = settings.hooks.SessionStart.filter(e =>
      Array.isArray(e.hooks) && e.hooks.some(h => h.command.includes('spec-superflow')),
    );
    assert.equal(ssfEntries.length, 1);
  });

  it('preserves unrelated skills in the shared skills directory', async () => {
    const pluginRoot = makePluginRoot();
    const configDir = join(tempDir, 'cb');
    const skillsDir = join(configDir, 'skills');
    mkdirSync(join(skillsDir, 'other-skill'), { recursive: true });
    writeFileSync(join(skillsDir, 'other-skill', 'SKILL.md'), '---\nname: other-skill\n---\n');

    await installCodeBuddy({ pluginRoot, configDir, applyPath: noopApplyPath });

    assert.ok(existsSync(join(skillsDir, 'other-skill', 'SKILL.md')), 'other skill preserved');
    assert.ok(existsSync(join(skillsDir, 'workflow-start', 'SKILL.md')), 'ssf skill deployed');
  });

  it('re-running install upgrades in place without duplicating SessionStart', async () => {
    const pluginRoot = makePluginRoot();
    const configDir = join(tempDir, 'cb');
    await installCodeBuddy({ pluginRoot, configDir, applyPath: noopApplyPath });
    await installCodeBuddy({ pluginRoot, configDir, applyPath: noopApplyPath });

    const settings = JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf-8'));
    const ssfEntries = settings.hooks.SessionStart.filter(e =>
      Array.isArray(e.hooks) && e.hooks.some(h => h.command.includes('spec-superflow')),
    );
    assert.equal(ssfEntries.length, 1, 'SessionStart ssf entry must not duplicate');
  });

  it('run --dry-run writes nothing to disk', async () => {
    const pluginRoot = makePluginRoot();
    const configDir = join(tempDir, 'cb-dry');
    const mod = await loadModule('scripts/lib/cmd-install-codebuddy.mjs');
    await mod.run(['--dry-run', '--local', pluginRoot, '--config-dir', configDir]);
    assert.ok(!existsSync(configDir), 'dry-run must not create the config dir');
  });

  it('throws when the commands tree is missing', () => {
    const pluginRoot = join(tempDir, 'bad-root');
    mkdirSync(join(pluginRoot, 'skills', 'workflow-start'), { recursive: true });
    writeFileSync(join(pluginRoot, 'skills', 'workflow-start', 'SKILL.md'), '---\nname: workflow-start\n---\n');
    writeFileSync(join(pluginRoot, 'package.json'), '{}');
    assert.throws(() => planInstall({ pluginRoot }), /commands\/ directory not found/);
  });
});

describe('hooks/session-start output format', () => {
  const scriptPath = join(process.cwd(), 'hooks', 'session-start');

  it('outputs hookSpecificOutput under CODEBUDDY_PROJECT_DIR', () => {
    const out = execFileSync('bash', [scriptPath], {
      env: { ...process.env, CODEBUDDY_PROJECT_DIR: '/tmp/cb-project' },
    }).toString();
    assert.match(out, /"hookSpecificOutput"/);
    assert.match(out, /"hookEventName": "SessionStart"/);
    assert.match(out, /"additionalContext"/);
  });

  it('falls back to top-level additionalContext when no platform env is set', () => {
    const { PATH = '' } = process.env;
    const out = execFileSync('bash', [scriptPath], {
      env: { PATH },
    }).toString();
    // No CURSOR/CLAUDE/CODEBUDDY env → else branch → top-level additionalContext.
    assert.match(out, /"additionalContext"/);
    assert.doesNotMatch(out, /"hookSpecificOutput"/);
  });
});

describe('cmd-uninstall-codebuddy', () => {
  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-cb-uninstall-'));
    const installMod = await loadModule('scripts/lib/cmd-install-codebuddy.mjs');
    planInstall = installMod.planInstall;
    installCodeBuddy = installMod.installCodeBuddy;
    const uninstallMod = await loadModule('scripts/lib/cmd-uninstall-codebuddy.mjs');
    planUninstall = uninstallMod.planUninstall;
    uninstallCodeBuddy = uninstallMod.uninstallCodeBuddy;
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function makePluginRoot({ skills = ['workflow-start', 'need-explorer'] } = {}) {
    const pluginRoot = join(tempDir, 'spec-superflow');
    for (const name of skills) {
      mkdirSync(join(pluginRoot, 'skills', name), { recursive: true });
      writeFileSync(join(pluginRoot, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
    }
    for (const command of ['resume', 'save', 'switch']) {
      const f = join(pluginRoot, 'commands', 'ssf', `${command}.md`);
      mkdirSync(join(f, '..'), { recursive: true });
      writeFileSync(f, `---\nallowed-tools: Bash(npx:*)\n---\nnpx --yes --package spec-superflow@0.12.1 ssf ${command}\n`);
    }
    writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ version: '0.12.1' }));
    return pluginRoot;
  }

  it('removes only spec-superflow artifacts and preserves other settings/hooks/skills', async () => {
    const pluginRoot = makePluginRoot();
    const configDir = join(tempDir, 'cb');
    await installCodeBuddy({ pluginRoot, configDir, applyPath: noopApplyPath });

    // Seed unrelated skill, rule, and SessionStart hook + settings field.
    const skillsDir = join(configDir, 'skills');
    mkdirSync(join(skillsDir, 'other-skill'), { recursive: true });
    writeFileSync(join(skillsDir, 'other-skill', 'SKILL.md'), '---\nname: other-skill\n---\n');
    mkdirSync(join(configDir, 'rules'), { recursive: true });
    writeFileSync(join(configDir, 'rules', 'other-rule.md'), '# other rule');
    const settingsPath = join(configDir, 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    settings.hooks.SessionStart.push({ hooks: [{ type: 'command', command: 'echo user-start' }] });
    settings.enabledPlugins = { 'other@market': true };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    const { removed } = await uninstallCodeBuddy({ configDir, applyPath: noopApplyPath });
    assert.ok(removed.length > 0);

    // spec-superflow artifacts gone
    assert.ok(!existsSync(join(configDir, 'spec-superflow')));
    assert.ok(!existsSync(join(configDir, 'commands', 'ssf')));
    assert.ok(!existsSync(join(configDir, 'rules', 'phase-guard.md')));
    assert.ok(!existsSync(join(skillsDir, 'workflow-start')));

    // unrelated artifacts preserved
    assert.ok(existsSync(join(skillsDir, 'other-skill', 'SKILL.md')));
    assert.ok(existsSync(join(configDir, 'rules', 'other-rule.md')));

    // settings.json still exists, ssf hook removed, user hook + enabledPlugins preserved
    const after = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    assert.equal(after.enabledPlugins['other@market'], true);
    const ssfAfter = (after.hooks?.SessionStart || []).filter(e =>
      Array.isArray(e.hooks) && e.hooks.some(h => h.command.includes('spec-superflow')),
    );
    assert.equal(ssfAfter.length, 0);
    const userAfter = (after.hooks?.SessionStart || []).filter(e =>
      Array.isArray(e.hooks) && e.hooks.some(h => !h.command.includes('spec-superflow')),
    );
    assert.equal(userAfter.length, 1);
  });

  it('preserves user-created commands/ssf/custom.md and only removes managed files', async () => {
    const pluginRoot = makePluginRoot();
    const configDir = join(tempDir, 'cb');
    await installCodeBuddy({ pluginRoot, configDir, applyPath: noopApplyPath });

    // Seed a user-created command in the shared commands/ssf/ directory.
    const ssfCommandsDir = join(configDir, 'commands', 'ssf');
    mkdirSync(ssfCommandsDir, { recursive: true });
    writeFileSync(join(ssfCommandsDir, 'custom.md'), '---\ndescription: user command\n---\nbody\n');

    await uninstallCodeBuddy({ configDir, applyPath: noopApplyPath });

    // Managed files removed
    assert.ok(!existsSync(join(ssfCommandsDir, 'resume.md')), 'resume.md removed');
    assert.ok(!existsSync(join(ssfCommandsDir, 'save.md')), 'save.md removed');
    assert.ok(!existsSync(join(ssfCommandsDir, 'switch.md')), 'switch.md removed');
    // User-created command preserved
    assert.ok(existsSync(join(ssfCommandsDir, 'custom.md')), 'custom.md preserved');
    // Directory preserved because it is non-empty
    assert.ok(existsSync(ssfCommandsDir), 'commands/ssf dir preserved (non-empty)');
  });

  it('removes all 9 spec-superflow skill directories on uninstall', async () => {
    const allSkills = ['workflow-start','build-executor','code-reviewer','contract-builder','need-explorer','release-archivist','spec-merger','spec-writer','bug-investigator'];
    const pluginRoot = makePluginRoot({ skills: allSkills });
    const configDir = join(tempDir, 'cb');
    await installCodeBuddy({ pluginRoot, configDir, applyPath: noopApplyPath });
    await uninstallCodeBuddy({ configDir, applyPath: noopApplyPath });
    for (const name of allSkills) {
      assert.ok(!existsSync(join(configDir, 'skills', name)), `${name} skill removed`);
    }
  });

  it('is safe when nothing is installed', async () => {
    const configDir = join(tempDir, 'empty-cb');
    const { removed } = await uninstallCodeBuddy({ configDir, applyPath: noopApplyPath });
    assert.equal(removed.length, 0);
  });

  it('removes the PATH entry on uninstall', async () => {
    const pluginRoot = makePluginRoot();
    const configDir = join(tempDir, 'cb');
    await installCodeBuddy({ pluginRoot, configDir, applyPath: noopApplyPath });

    const calls = [];
    const recordingApplyPath = async (opts) => {
      calls.push(opts);
      return { applied: true, detail: 'recorded' };
    };
    await uninstallCodeBuddy({ configDir, applyPath: recordingApplyPath });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'remove');
    assert.equal(calls[0].binDir, join(configDir, 'spec-superflow', 'bin'));
    // runtime dir (incl. bin/ shims) gone
    assert.ok(!existsSync(join(configDir, 'spec-superflow')));
  });

  it('run --dry-run writes nothing', async () => {
    const pluginRoot = makePluginRoot();
    const configDir = join(tempDir, 'cb');
    await installCodeBuddy({ pluginRoot, configDir, applyPath: noopApplyPath });
    const mod = await loadModule('scripts/lib/cmd-uninstall-codebuddy.mjs');
    await mod.run(['--dry-run', '--config-dir', configDir]);
    assert.ok(existsSync(join(configDir, 'spec-superflow')), 'dry-run must not delete artifacts');
  });
});
