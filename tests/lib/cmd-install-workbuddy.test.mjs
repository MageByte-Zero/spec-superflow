// tests/lib/cmd-install-workbuddy.test.mjs
// Tests for scripts/lib/cmd-install-workbuddy.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

let tempDir;
let planInstall, installWorkBuddy;

describe('cmd-install-workbuddy', () => {
  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-workbuddy-'));
    const mod = await import(pathToFileURL(join(process.cwd(), 'scripts/lib/cmd-install-workbuddy.mjs')).href);
    planInstall = mod.planInstall;
    installWorkBuddy = mod.installWorkBuddy;
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  function makePluginRoot({ commands = ['resume', 'save', 'switch'], name = 'spec-superflow' } = {}) {
    const pluginRoot = join(tempDir, name);
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

    // Phase-guard rule deployed with the actual four-mode contract.
    const guardPath = join(pluginDir, 'rules', 'phase-guard.md');
    assert.ok(existsSync(guardPath));
    const guard = readFileSync(guardPath, 'utf-8');
    assert.match(guard, /Full 或 legacy Hotfix/);
    assert.match(guard, /Quick、direct Hotfix、tweak/);
    assert.match(guard, /test_result: pass/);

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
      /canonical command tree/,
    );
    assert.equal(existsSync(homeDir), false);
  });

  it('rewrites recovery command authorization together with its runtime command', async () => {
    const pluginRoot = makePluginRoot();
    const homeDir = join(tempDir, 'authorization-home');
    const resume = join(pluginRoot, 'commands', 'ssf', 'resume.md');
    writeFileSync(resume, [
      '---',
      'description: resume',
      'allowed-tools: Bash(ssf:*)',
      '---',
      '',
      'Run `ssf resume --json`.',
      '',
    ].join('\n'));

    await installWorkBuddy({ pluginRoot, homeDir, marketplaceName: 'test' });

    const installed = readFileSync(join(homeDir, '.workbuddy', 'plugins', 'marketplaces', 'test', 'plugins', 'spec-superflow', 'commands', 'ssf', 'resume.md'), 'utf8');
    assert.match(installed, /allowed-tools: Bash\(node:\*\)/);
    assert.match(installed, /node ['"]?.*scripts[\\/]spec-superflow\.mjs['"]? resume --json/);
    assert.doesNotMatch(installed, /\bssf resume --json/);
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

  it('rejects extra regular files inside the canonical command directory before writing WorkBuddy home', async () => {
    const pluginRoot = makePluginRoot();
    const homeDir = join(tempDir, 'extra-command-file-home');
    writeFileSync(join(pluginRoot, 'commands', 'ssf', 'notes.txt'), 'not a command\n');

    assert.throws(
      () => planInstall({ pluginRoot, homeDir }),
      /canonical command tree/,
    );
    await assert.rejects(
      installWorkBuddy({ pluginRoot, homeDir, marketplaceName: 'test' }),
      /canonical command tree/,
    );
    assert.equal(existsSync(homeDir), false);
  });

  it('rejects unexpected files and directories at the commands root before writing WorkBuddy home', async () => {
    const cases = [
      {
        name: 'root-file',
        mutate: pluginRoot => writeFileSync(join(pluginRoot, 'commands', 'notes.txt'), 'not a command\n'),
      },
      {
        name: 'root-directory',
        mutate: pluginRoot => mkdirSync(join(pluginRoot, 'commands', 'other'), { recursive: true }),
      },
    ];

    for (const { name, mutate } of cases) {
      const pluginRoot = makePluginRoot({ name: `spec-superflow-${name}` });
      const homeDir = join(tempDir, `${name}-home`);
      mutate(pluginRoot);

      assert.throws(() => planInstall({ pluginRoot, homeDir }), /canonical command tree/);
      await assert.rejects(
        installWorkBuddy({ pluginRoot, homeDir, marketplaceName: 'test' }),
        /canonical command tree/,
      );
      assert.equal(existsSync(homeDir), false);
    }
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

  it('installs only the immutable command snapshot when source changes after planning', async () => {
    const pluginRoot = makePluginRoot();
    const homeDir = join(tempDir, 'snapshot-home');
    const plan = planInstall({ pluginRoot, homeDir, marketplaceName: 'test' });
    assert.equal(plan.commandAssets.length, 3);
    assert.deepEqual(
      plan.commandAssets.map(asset => asset.relativePath),
      ['ssf/resume.md', 'ssf/save.md', 'ssf/switch.md'],
    );

    writeFileSync(join(pluginRoot, 'commands', 'ssf', 'resume.md'), '# changed after planning\n');
    writeFileSync(join(pluginRoot, 'commands', 'ssf', 'late-addition.md'), '# should not install\n');

    const result = await installWorkBuddy({ pluginRoot, homeDir, marketplaceName: 'test', plan });
    assert.equal(result, plan);
    assert.equal(readFileSync(join(plan.targetCommands, 'ssf', 'resume.md'), 'utf-8'), '# resume\n');
    assert.equal(existsSync(join(plan.targetCommands, 'ssf', 'late-addition.md')), false);
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
      const installed = readFileSync(join(result.targetCommands, 'ssf', `${name}.md`), 'utf-8');
      assert.match(installed, /allowed-tools: Bash\(node:\*\)/);
      assert.match(installed, /node .*scripts[\\/]spec-superflow\.mjs/);
      assert.doesNotMatch(installed, /\bssf (?:resume|save|switch)\b/);
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
