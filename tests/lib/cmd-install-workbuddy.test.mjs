// tests/lib/cmd-install-workbuddy.test.mjs
// Tests for scripts/lib/cmd-install-workbuddy.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
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

  function makePluginRoot() {
    const pluginRoot = join(tempDir, 'spec-superflow');
    const skillsDir = join(pluginRoot, 'skills');
    mkdirSync(join(skillsDir, 'workflow-start'), { recursive: true });
    mkdirSync(join(skillsDir, 'need-explorer'), { recursive: true });
    writeFileSync(join(skillsDir, 'workflow-start', 'SKILL.md'), '---\nname: workflow-start\n---\n');
    writeFileSync(join(skillsDir, 'need-explorer', 'SKILL.md'), '---\nname: need-explorer\n---\n');
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
  });

  it('uses the package root by default instead of the caller cwd', () => {
    const previousCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const plan = planInstall({ homeDir: join(tempDir, 'home') });
      assert.equal(plan.skillNames.length, 9);
      assert.ok(plan.skillsDir.endsWith('spec-superflow/skills'));
    } finally {
      process.chdir(previousCwd);
    }
  });
});
