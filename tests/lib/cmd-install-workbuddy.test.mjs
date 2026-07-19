// tests/lib/cmd-install-workbuddy.test.mjs
// Tests for scripts/lib/cmd-install-workbuddy.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir;
let planInstall, installWorkBuddy;

describe('cmd-install-workbuddy', () => {
  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-workbuddy-'));
    const mod = await import(join(process.cwd(), 'scripts/lib/cmd-install-workbuddy.mjs'));
    planInstall = mod.planInstall;
    installWorkBuddy = mod.installWorkBuddy;
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function makePluginRoot({ commands = ['resume', 'save', 'switch'] } = {}) {
    const pluginRoot = join(tempDir, 'spec-superflow');
    const skillsDir = join(pluginRoot, 'skills');
    mkdirSync(join(skillsDir, 'workflow-start'), { recursive: true });
    mkdirSync(join(skillsDir, 'need-explorer'), { recursive: true });
    writeFileSync(join(skillsDir, 'workflow-start', 'SKILL.md'), '---\nname: workflow-start\n---\n');
    writeFileSync(join(skillsDir, 'need-explorer', 'SKILL.md'), '---\nname: need-explorer\n---\n');
    for (const command of commands) {
      const commandFile = join(pluginRoot, 'commands', 'ssf', `${command}.md`);
      mkdirSync(join(commandFile, '..'), { recursive: true });
      writeFileSync(commandFile, `# ${command}\n`);
    }
    writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ version: '0.8.14' }));
    return pluginRoot;
  }

  it('plans WorkBuddy marketplace paths and single enabled plugin key', () => {
    const pluginRoot = makePluginRoot();
    const plan = planInstall({
      pluginRoot,
      homeDir: join(tempDir, 'home'),
      marketplaceName: 'cb_teams_marketplace',
    });

    assert.deepEqual(plan.skillNames, ['need-explorer', 'workflow-start']);
    assert.equal(
      plan.pluginsDir,
      join(tempDir, 'home', '.workbuddy', 'plugins', 'marketplaces', 'cb_teams_marketplace', 'plugins'),
    );
    // Single plugin key, not per-skill.
    assert.equal(plan.enabledPluginKey, 'spec-superflow@cb_teams_marketplace');
    // Plugin dir targets spec-superflow, not per-skill.
    assert.equal(plan.targetPluginDir, join(plan.pluginsDir, 'spec-superflow'));
    assert.equal(plan.targetSkills, join(plan.targetPluginDir, 'skills'));
    assert.equal(plan.targetRules, join(plan.targetPluginDir, 'rules'));
    assert.deepEqual(plan.commandNames, ['ssf:resume', 'ssf:save', 'ssf:switch']);
    assert.equal(plan.commandsDir, join(pluginRoot, 'commands'));
    assert.equal(plan.targetCommands, join(plan.targetPluginDir, 'commands'));
  });

  it('deploys skills, runtime dirs, rules, manifest, and preserves existing settings', async () => {
    const pluginRoot = makePluginRoot();
    const homeDir = join(tempDir, 'home');
    const settingsDir = join(homeDir, '.workbuddy');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'existing@codebuddy-plugins-official': true } }, null, 2),
    );

    // Create a scripts dir so RUNTIME_DIRS copy has something to copy.
    mkdirSync(join(pluginRoot, 'scripts'), { recursive: true });
    writeFileSync(join(pluginRoot, 'scripts', 'check-update.mjs'), '// test');

    const result = await installWorkBuddy({ pluginRoot, homeDir, marketplaceName: 'cb_teams_marketplace' });
    assert.equal(result.skillNames.length, 2);
    assert.deepEqual(result.commandNames, ['ssf:resume', 'ssf:save', 'ssf:switch']);

    // Settings: existing key preserved, single spec-superflow key added.
    const settings = JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf-8'));
    assert.equal(settings.enabledPlugins['existing@codebuddy-plugins-official'], true);
    assert.equal(settings.enabledPlugins['spec-superflow@cb_teams_marketplace'], true);
    // Old per-skill keys should NOT exist.
    assert.equal(settings.enabledPlugins['workflow-start@cb_teams_marketplace'], undefined);
    assert.equal(settings.enabledPlugins['need-explorer@cb_teams_marketplace'], undefined);

    // Skills deployed under <plugin>/skills/<name>/SKILL.md
    const pluginDir = join(homeDir, '.workbuddy', 'plugins', 'marketplaces', 'cb_teams_marketplace', 'plugins', 'spec-superflow');
    assert.match(
      readFileSync(join(pluginDir, 'skills', 'workflow-start', 'SKILL.md'), 'utf-8'),
      /workflow-start/,
    );

    // Runtime dirs copied.
    assert.ok(existsSync(join(pluginDir, 'scripts', 'check-update.mjs')));

    // Phase-guard rule deployed.
    assert.ok(existsSync(join(pluginDir, 'rules', 'phase-guard.md')));

    // Plugin manifest deployed.
    const manifest = JSON.parse(readFileSync(join(pluginDir, '.codebuddy-plugin', 'plugin.json'), 'utf-8'));
    assert.equal(manifest.name, 'spec-superflow');
    assert.equal(manifest.skills.length, 2);

    // Canonical recovery commands deploy as complete Markdown assets.
    for (const name of ['resume', 'save', 'switch']) {
      assert.equal(readFileSync(join(pluginDir, 'commands', 'ssf', `${name}.md`), 'utf-8'), `# ${name}\n`);
    }
  });

  it('rejects missing or incomplete canonical recovery commands before installing', () => {
    const homeDir = join(tempDir, 'home');
    assert.throws(
      () => planInstall({ pluginRoot: makePluginRoot({ commands: [] }), homeDir }),
      /commands\/ directory not found/,
    );
    assert.throws(
      () => planInstall({ pluginRoot: makePluginRoot({ commands: ['resume', 'save'] }), homeDir }),
      /canonical recovery command set/,
    );
    assert.equal(existsSync(homeDir), false);
  });

  it('rejects symbolic links in the canonical command tree before writing WorkBuddy home', async () => {
    const pluginRoot = makePluginRoot();
    const homeDir = join(tempDir, 'symlink-home');
    const source = join(pluginRoot, 'commands', 'ssf', 'resume.md');
    symlinkSync(source, join(pluginRoot, 'commands', 'ssf', 'linked-command.md'));

    assert.throws(
      () => planInstall({ pluginRoot, homeDir }),
      /symbolic links are not allowed in command source/,
    );
    await assert.rejects(
      installWorkBuddy({ pluginRoot, homeDir, marketplaceName: 'test' }),
      /symbolic links are not allowed in command source/,
    );
    assert.equal(existsSync(homeDir), false);
  });

  it('dry-run reports commands and does not write the requested home directory', () => {
    const pluginRoot = makePluginRoot();
    const homeDir = join(tempDir, 'dry-run-home');
    const cli = join(process.cwd(), 'scripts', 'spec-superflow.mjs');
    const stdout = execFileSync(process.execPath, [
      cli,
      'install-workbuddy',
      '--local', pluginRoot,
      '--home', homeDir,
      '--dry-run',
    ], { encoding: 'utf-8' });

    assert.match(stdout, /Commands:\s+3 \(ssf:resume, ssf:save, ssf:switch\)/);
    assert.match(stdout, /Command dir:/);
    assert.equal(existsSync(homeDir), false);
  });

  it('reports the recursive command file count during installation', () => {
    const pluginRoot = makePluginRoot();
    const homeDir = join(tempDir, 'count-home');
    const cli = join(process.cwd(), 'scripts', 'spec-superflow.mjs');
    const stdout = execFileSync(process.execPath, [
      cli,
      'install-workbuddy',
      '--local', pluginRoot,
      '--home', homeDir,
    ], { encoding: 'utf-8' });

    assert.match(stdout, /commands\/.*\(3 entries, 3 commands\)/);
  });

  it('rebuilds the plugin directory so stale commands are removed', async () => {
    const pluginRoot = makePluginRoot();
    const homeDir = join(tempDir, 'home');
    const first = await installWorkBuddy({ pluginRoot, homeDir, marketplaceName: 'test' });
    const staleCommand = join(first.targetCommands, 'ssf', 'legacy.md');
    writeFileSync(staleCommand, '# legacy\n');

    const second = await installWorkBuddy({ pluginRoot, homeDir, marketplaceName: 'test' });
    assert.ok(existsSync(join(second.targetCommands, 'ssf', 'resume.md')));
    assert.equal(existsSync(staleCommand), false);
  });

  it('installs all canonical package assets into a real temporary WorkBuddy home', async () => {
    const pluginRoot = process.cwd();
    const homeDir = join(tempDir, 'real-home');
    const settingsDir = join(homeDir, '.workbuddy');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify({
      enabledPlugins: {
        'workflow-start@cb_teams_marketplace': true,
        'unrelated@marketplace': true,
      },
    }));

    const result = await installWorkBuddy({ pluginRoot, homeDir, marketplaceName: 'cb_teams_marketplace' });
    assert.equal(result.skillNames.length, 9);
    assert.deepEqual(result.commandNames, ['ssf:resume', 'ssf:save', 'ssf:switch']);
    for (const runtimeDir of ['scripts', 'docs', 'templates', 'dist', 'hooks']) {
      assert.ok(existsSync(join(result.targetPluginDir, runtimeDir)), `${runtimeDir}/ should be installed`);
    }
    assert.ok(existsSync(join(result.targetRules, 'phase-guard.md')));
    assert.ok(existsSync(join(result.manifestDir, 'plugin.json')));
    for (const name of ['resume', 'save', 'switch']) {
      assert.equal(
        readFileSync(join(result.targetCommands, 'ssf', `${name}.md`), 'utf-8'),
        readFileSync(join(pluginRoot, 'commands', 'ssf', `${name}.md`), 'utf-8'),
      );
    }

    const settings = JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf-8'));
    assert.equal(settings.enabledPlugins['spec-superflow@cb_teams_marketplace'], true);
    assert.equal(settings.enabledPlugins['workflow-start@cb_teams_marketplace'], undefined);
    assert.equal(settings.enabledPlugins['unrelated@marketplace'], true);
  });

  it('uses the package root by default instead of the caller cwd', () => {
    const previousCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = planInstall({ homeDir: join(tempDir, 'home') });
      assert.equal(plan.skillNames.length, 9);
      assert.equal(plan.skillsDir, join(plan.pluginRoot, 'skills'));
      assert.ok(existsSync(plan.skillsDir));
      assert.notEqual(plan.skillsDir, join(tempDir, 'skills'));
    } finally {
      process.chdir(previousCwd);
    }
  });
});
