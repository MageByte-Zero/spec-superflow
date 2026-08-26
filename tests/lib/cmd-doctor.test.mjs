// tests/lib/cmd-doctor.test.mjs
// Tests for scripts/lib/cmd-doctor.mjs check functions
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

let tempDir;

describe('cmd-doctor: checkVersionConsistency()', () => {
  let checkVersionConsistency;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-doctor-ver-'));
    const modulePath = join(process.cwd(), 'scripts/lib/cmd-doctor.mjs');
    const mod = await import(pathToFileURL(modulePath).href);
    checkVersionConsistency = mod.checkVersionConsistency;
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes when all manifests have same version', () => {
    const version = '1.0.0';
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ version }));
    writeFileSync(join(tempDir, 'plugin.json'), JSON.stringify({ version }));
    mkdirSync(join(tempDir, '.claude-plugin'), { recursive: true });
    writeFileSync(join(tempDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ version }));

    const result = checkVersionConsistency(tempDir);
    assert.equal(result.pass, true);
  });

  it('fails when manifests have different versions', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    writeFileSync(join(tempDir, 'plugin.json'), JSON.stringify({ version: '0.9.0' }));

    const result = checkVersionConsistency(tempDir);
    assert.equal(result.pass, false);
    assert.ok(result.message.includes('mismatch'));
  });

  it('handles missing manifests gracefully', () => {
    // Clean up any lingering files from previous tests
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    // Don't create other manifests — should still pass (unique versions <= 1)

    const result = checkVersionConsistency(tempDir);
    assert.equal(result.pass, true, `Expected pass but got: ${result.message}`);
  });

  it('fails when a marketplace metadata version differs from the plugin version', () => {
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(join(tempDir, '.github', 'plugin'), { recursive: true });
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    writeFileSync(join(tempDir, '.github', 'plugin', 'marketplace.json'), JSON.stringify({
      metadata: { version: '0.9.0' },
      plugins: [{ version: '1.0.0' }],
    }));

    const result = checkVersionConsistency(tempDir);
    assert.equal(result.pass, false);
    assert.ok(result.message.includes('.github/plugin/marketplace.json'));
  });
});

describe('cmd-doctor: checkHooks()', () => {
  let checkHooks;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-doctor-hooks-'));
    const modulePath = join(process.cwd(), 'scripts/lib/cmd-doctor.mjs');
    const mod = await import(pathToFileURL(modulePath).href);
    checkHooks = mod.checkHooks;
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('fails when hooks.json does not exist', () => {
    const result = checkHooks(tempDir);
    assert.equal(result.pass, false);
    assert.ok(result.message.includes('not found'));
  });

  it('passes when hooks.json has valid record format', () => {
    mkdirSync(join(tempDir, 'hooks'), { recursive: true });
    writeFileSync(join(tempDir, 'hooks', 'hooks.json'), JSON.stringify({
      hooks: { SessionStart: [{ command: 'bash hooks/session-start' }] },
    }));

    const result = checkHooks(tempDir);
    assert.equal(result.pass, true);
  });

  it('fails when hooks.json has array format (legacy)', () => {
    writeFileSync(join(tempDir, 'hooks', 'hooks.json'), JSON.stringify({
      hooks: [{ event: 'SessionStart', command: 'bash hooks/session-start' }],
    }));

    const result = checkHooks(tempDir);
    assert.equal(result.pass, false);
    assert.ok(result.message.includes('invalid format'));
  });

  it('fails on invalid JSON', () => {
    writeFileSync(join(tempDir, 'hooks', 'hooks.json'), 'not json {{{');

    const result = checkHooks(tempDir);
    assert.equal(result.pass, false);
    assert.ok(result.message.includes('parse error'));
  });
});

describe('cmd-doctor: checkCodexManifest()', () => {
  let checkCodexManifest;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-doctor-codex-'));
    const modulePath = join(process.cwd(), 'scripts/lib/cmd-doctor.mjs');
    const mod = await import(pathToFileURL(modulePath).href);
    checkCodexManifest = mod.checkCodexManifest;
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('fails when Codex manifest is missing', () => {
    const result = checkCodexManifest(tempDir);
    assert.equal(result.pass, false);
    assert.ok(result.message.includes('not found'));
  });

  it('fails when hooks is absent because Codex auto-discovers hooks/hooks.json', () => {
    mkdirSync(join(tempDir, '.codex-plugin'), { recursive: true });
    writeFileSync(join(tempDir, '.codex-plugin', 'plugin.json'), JSON.stringify({
      interface: { category: 'Developer Tools' },
    }));

    const result = checkCodexManifest(tempDir);
    assert.equal(result.pass, false);
    assert.ok(result.message.includes('hooks to {}'));
  });

  it('fails when category is not Developer Tools', () => {
    writeFileSync(join(tempDir, '.codex-plugin', 'plugin.json'), JSON.stringify({
      hooks: {},
      interface: { category: 'Productivity' },
    }));

    const result = checkCodexManifest(tempDir);
    assert.equal(result.pass, false);
    assert.ok(result.message.includes('Developer Tools'));
  });

  it('passes when hooks are explicitly suppressed and category is Developer Tools', () => {
    writeFileSync(join(tempDir, '.codex-plugin', 'plugin.json'), JSON.stringify({
      hooks: {},
      interface: { category: 'Developer Tools' },
    }));

    const result = checkCodexManifest(tempDir);
    assert.equal(result.pass, true);
  });
});

describe('cmd-doctor: checkSkills()', () => {
  let checkSkills;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-doctor-skills-'));
    const modulePath = join(process.cwd(), 'scripts/lib/cmd-doctor.mjs');
    const mod = await import(pathToFileURL(modulePath).href);
    checkSkills = mod.checkSkills;
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('fails when skills/ directory does not exist', () => {
    const result = checkSkills(tempDir);
    assert.equal(result.pass, false);
  });

  it('passes when all skill dirs have SKILL.md', () => {
    const skillsDir = join(tempDir, 'skills');
    mkdirSync(join(skillsDir, 'workflow-start'), { recursive: true });
    mkdirSync(join(skillsDir, 'need-explorer'), { recursive: true });
    writeFileSync(join(skillsDir, 'workflow-start', 'SKILL.md'), '# Skill');
    writeFileSync(join(skillsDir, 'need-explorer', 'SKILL.md'), '# Skill');

    const result = checkSkills(tempDir);
    assert.equal(result.pass, true);
    assert.ok(result.message.includes('2/2'));
  });

  it('fails when some skills missing SKILL.md', () => {
    const skillsDir = join(tempDir, 'skills');
    rmSync(skillsDir, { recursive: true, force: true });
    mkdirSync(join(skillsDir, 'workflow-start'), { recursive: true });
    mkdirSync(join(skillsDir, 'empty-skill'), { recursive: true });
    writeFileSync(join(skillsDir, 'workflow-start', 'SKILL.md'), '# Skill');
    // empty-skill has no SKILL.md

    const result = checkSkills(tempDir);
    assert.equal(result.pass, false);
    assert.ok(result.message.includes('empty-skill'));
    assert.ok(result.message.includes('1/2'));
  });
});

describe('cmd-doctor: checkDist()', () => {
  let checkDist;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-doctor-dist-'));
    const modulePath = join(process.cwd(), 'scripts/lib/cmd-doctor.mjs');
    const mod = await import(pathToFileURL(modulePath).href);
    checkDist = mod.checkDist;
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('fails when dist/ directory does not exist', () => {
    const result = checkDist(tempDir);
    assert.equal(result.pass, false);
  });

  it('fails when dist/index.js missing', () => {
    mkdirSync(join(tempDir, 'dist'), { recursive: true });
    const result = checkDist(tempDir);
    assert.equal(result.pass, false);
    assert.ok(result.message.includes('not found'));
  });

  it('passes when dist/index.js exists', () => {
    writeFileSync(join(tempDir, 'dist', 'index.js'), '// compiled');
    const result = checkDist(tempDir);
    assert.equal(result.pass, true);
  });
});

describe('cmd-doctor: checkRootPluginAuthor()', () => {
  let checkRootPluginAuthor;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-doctor-author-'));
    const modulePath = join(process.cwd(), 'scripts/lib/cmd-doctor.mjs');
    const mod = await import(pathToFileURL(modulePath).href);
    checkRootPluginAuthor = mod.checkRootPluginAuthor;
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('fails when plugin.json does not exist', () => {
    const result = checkRootPluginAuthor(tempDir);
    assert.equal(result.pass, false);
  });

  it('fails when author is a string (Copilot strict validation)', () => {
    writeFileSync(join(tempDir, 'plugin.json'), JSON.stringify({
      author: 'MageByte',
    }));

    const result = checkRootPluginAuthor(tempDir);
    assert.equal(result.pass, false);
    assert.ok(result.message.includes('must be an object'));
  });

  it('passes when author is an object with name', () => {
    writeFileSync(join(tempDir, 'plugin.json'), JSON.stringify({
      author: { name: 'MageByte' },
    }));

    const result = checkRootPluginAuthor(tempDir);
    assert.equal(result.pass, true);
    assert.ok(result.message.includes('MageByte'));
  });

  it('fails when author object missing name', () => {
    writeFileSync(join(tempDir, 'plugin.json'), JSON.stringify({
      author: { email: 'test@example.com' },
    }));

    const result = checkRootPluginAuthor(tempDir);
    assert.equal(result.pass, false);
  });
});

describe('cmd-doctor: checkNodeVersion()', () => {
  let checkNodeVersion;

  before(async () => {
    const modulePath = join(process.cwd(), 'scripts/lib/cmd-doctor.mjs');
    const mod = await import(pathToFileURL(modulePath).href);
    checkNodeVersion = mod.checkNodeVersion;
  });

  it('accepts Node 20 as the minimum supported runtime', () => {
    const result = checkNodeVersion('v20.0.0');
    assert.equal(result.pass, true);
    assert.equal(result.message, 'v20.0.0');
  });

  it('rejects Node 19 with the Node 20 repair guidance', () => {
    const result = checkNodeVersion('v19.9.0');
    assert.equal(result.pass, false);
    assert.match(result.message, /v19\.9\.0 \(requires >= 20\)/);
  });

  it('checks the current Node.js version when no version is supplied', () => {
    const result = checkNodeVersion();
    assert.ok(result.message.includes(process.version));
  });
});

describe('cmd-doctor: checkDocs()', () => {
  let checkDocs;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-doctor-docs-'));
    const modulePath = join(process.cwd(), 'scripts/lib/cmd-doctor.mjs');
    const mod = await import(pathToFileURL(modulePath).href);
    checkDocs = mod.checkDocs;
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns skipped when no package.json', () => {
    const result = checkDocs(tempDir);
    assert.equal(result.pass, true);
    assert.ok(result.message.includes('skipped'));
  });

  it('warns when CHANGELOG missing current version entry', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    writeFileSync(join(tempDir, 'CHANGELOG.md'), '# Changelog\n\n## [1.0.0]\n- old stuff');

    const result = checkDocs(tempDir);
    assert.equal(result.pass, false);
    assert.ok(result.message.includes('1.2.3'));
  });

  it('passes when CHANGELOG has current version', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    writeFileSync(join(tempDir, 'CHANGELOG.md'), '# Changelog\n\n## [1.2.3]\n- new stuff');

    const result = checkDocs(tempDir);
    assert.equal(result.pass, true);
  });
});

describe('cmd-doctor: checkRuntimeDistribution()', () => {
  let checkRuntimeDistribution;

  before(async () => {
    const modulePath = join(process.cwd(), 'scripts/lib/cmd-doctor.mjs');
    const mod = await import(pathToFileURL(modulePath).href);
    checkRuntimeDistribution = mod.checkRuntimeDistribution;
  });

  it('passes for the canonical package and reports platform coverage', () => {
    const result = checkRuntimeDistribution(process.cwd());

    assert.equal(result.pass, true, result.message);
    assert.match(result.message, /17 platforms/);
  });

  it('reports an unrewritten plugin-root placeholder as an upgrade issue', () => {
    const root = mkdtempSync(join(tmpdir(), 'ssf-doctor-runtime-'));
    try {
      mkdirSync(join(root, 'skills', 'workflow-start'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
      writeFileSync(join(root, 'skills', 'workflow-start', 'SKILL.md'),
        'node "${CLAUDE_PLUGIN_ROOT}/scripts/spec-superflow.mjs" state get demo');

      const result = checkRuntimeDistribution(root);
      assert.equal(result.pass, false);
      assert.match(result.message, /plugin-root placeholder|reinstall/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('checks code-reviewer as a portable runtime skill', () => {
    const root = mkdtempSync(join(tmpdir(), 'ssf-doctor-code-reviewer-'));
    try {
      mkdirSync(join(root, 'skills', 'code-reviewer'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
      writeFileSync(join(root, 'skills', 'code-reviewer', 'SKILL.md'),
        'node "${CLAUDE_PLUGIN_ROOT}/scripts/spec-superflow.mjs" execution review demo');

      const result = checkRuntimeDistribution(root);
      assert.equal(result.pass, false);
      assert.match(result.message, /code-reviewer: plugin-root placeholder remains/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a local command whose referenced runtime file is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'ssf-doctor-stale-runtime-'));
    try {
      mkdirSync(join(root, 'skills', 'workflow-start'), { recursive: true });
      mkdirSync(join(root, 'scripts'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
      writeFileSync(join(root, 'scripts', 'spec-superflow.mjs'), '// unrelated bundled CLI');
      writeFileSync(join(root, 'skills', 'workflow-start', 'SKILL.md'),
        'node "/tmp/missing-runtime/scripts/spec-superflow.mjs" state get demo');

      const result = checkRuntimeDistribution(root);
      assert.equal(result.pass, false);
      assert.match(result.message, /workflow-start: local runtime tree is missing/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts a POSIX-escaped local runtime path containing a single quote', { skip: process.platform === 'win32' && 'POSIX-only shell quoting' }, () => {
    const root = mkdtempSync(join(tmpdir(), "ssf-doctor-quote-'"));
    try {
      const localCli = join(root, 'scripts', 'spec-superflow.mjs');
      mkdirSync(join(root, 'skills', 'workflow-start'), { recursive: true });
      mkdirSync(join(root, 'scripts'), { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
      writeFileSync(localCli, '// bundled CLI');
      const quotedCli = `'${localCli.replace(/'/g, "'\\''")}'`;
      writeFileSync(join(root, 'skills', 'workflow-start', 'SKILL.md'),
        `node ${quotedCli} state get demo`);

      const result = checkRuntimeDistribution(root);
      assert.equal(result.pass, true, result.message);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
