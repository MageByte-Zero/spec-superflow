// ssf doctor — health check for spec-superflow installation and project
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config-loader.mjs';
import { PLATFORM_RUNTIME_INVENTORY } from './platform-runtime-inventory.mjs';

const RUNTIME_SKILLS = new Set([
  'workflow-start', 'need-explorer', 'spec-writer', 'contract-builder',
  'build-executor', 'code-reviewer', 'bug-investigator', 'release-archivist', 'spec-merger',
]);

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try { return JSON.parse(readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function checkVersionConsistency(root) {
  const files = [
    { name: 'package.json', path: ['version'] },
    { name: 'plugin.json', path: ['version'] },
    { name: '.claude-plugin/plugin.json', path: ['version'] },
    { name: '.claude-plugin/marketplace.json', path: ['plugins', '0', 'version'] },
    { name: '.cursor-plugin/plugin.json', path: ['version'] },
    { name: '.cursor-plugin/marketplace.json', path: ['metadata', 'version'] },
    { name: '.codex-plugin/plugin.json', path: ['version'] },
    { name: 'gemini-extension.json', path: ['version'] },
    { name: '.github/plugin/marketplace.json', path: ['metadata', 'version'] },
    { name: '.github/plugin/marketplace.json', path: ['plugins', '0', 'version'] },
  ];

  const versions = {};
  for (const f of files) {
    const key = `${f.name}:${f.path.join('.')}`;
    const data = readJsonIfExists(join(root, f.name));
    if (!data) { versions[key] = null; continue; }
    let val = data;
    for (const p of f.path) val = val?.[p];
    versions[key] = val || null;
  }

  const uniqueVersions = [...new Set(Object.values(versions).filter(Boolean))];
  const pkgVersion = versions['package.json:version'];

  if (uniqueVersions.length <= 1) {
    return { pass: true, message: `Version: ${pkgVersion} (consistent across ${Object.keys(versions).filter(k => versions[k]).length} manifest fields)` };
  }
  const mismatches = Object.entries(versions)
    .filter(([, v]) => v !== pkgVersion)
    .map(([name, v]) => `${name}=${v}`)
    .join(', ');
  return { pass: false, message: `Version mismatch: ${pkgVersion} (package.json) vs ${mismatches}` };
}

function checkHooks(root) {
  const hooksPath = join(root, 'hooks', 'hooks.json');
  if (!existsSync(hooksPath)) {
    return { pass: false, message: 'hooks/hooks.json not found' };
  }
  try {
    const hooks = JSON.parse(readFileSync(hooksPath, 'utf-8'));
    if (hooks.hooks && typeof hooks.hooks === 'object' && !Array.isArray(hooks.hooks)) {
      return { pass: true, message: 'valid format' };
    }
    return { pass: false, message: 'invalid format (expected record, got ' + typeof hooks.hooks + ')' };
  } catch (e) {
    return { pass: false, message: `parse error: ${e.message}` };
  }
}

function checkCodexManifest(root) {
  const manifestPath = join(root, '.codex-plugin', 'plugin.json');
  const manifest = readJsonIfExists(manifestPath);
  if (!manifest) {
    return { pass: false, message: '.codex-plugin/plugin.json not found' };
  }
  if (JSON.stringify(manifest.hooks) !== '{}') {
    return {
      pass: false,
      message: 'Codex manifest must set hooks to {} to suppress hooks/hooks.json auto-discovery',
    };
  }
  if (manifest.interface?.category !== 'Developer Tools') {
    return { pass: false, message: 'Codex category should be Developer Tools' };
  }
  return { pass: true, message: 'hooks suppressed, category Developer Tools' };
}

function checkSkills(root) {
  const skillsDir = join(root, 'skills');
  if (!existsSync(skillsDir)) {
    return { pass: false, message: 'skills/ directory not found' };
  }
  const dirs = readdirSync(skillsDir).filter(f => {
    try { return statSync(join(skillsDir, f)).isDirectory(); } catch { return false; }
  });
  const withSkillMd = dirs.filter(d => existsSync(join(skillsDir, d, 'SKILL.md')));
  if (withSkillMd.length === dirs.length) {
    return { pass: true, message: `${dirs.length}/${dirs.length} present` };
  }
  const missing = dirs.filter(d => !withSkillMd.includes(d));
  return { pass: false, message: `${withSkillMd.length}/${dirs.length} present, missing SKILL.md: ${missing.join(', ')}` };
}

function localRuntimePaths(content) {
  const doubleQuoted = [...content.matchAll(/node\s+"([^"]+\/scripts\/spec-superflow\.mjs)"/g)]
    .map(match => match[1]);
  const singleQuoted = [...content.matchAll(/node\s+'(.+\/scripts\/spec-superflow\.mjs)'/g)]
    .map(match => match[1].split("'\\''").join("'"));
  return [...doubleQuoted, ...singleQuoted];
}

function checkRuntimeDistribution(root) {
  const pkg = readJsonIfExists(join(root, 'package.json'));
  const skillsDir = join(root, 'skills');
  if (!pkg?.version || !existsSync(skillsDir)) {
    return { pass: false, message: 'runtime distribution cannot be checked: package.json or skills/ is missing; reinstall spec-superflow' };
  }

  const sourceRuntimeCommand = 'node scripts/spec-superflow.mjs';
  const issues = [];
  for (const name of readdirSync(skillsDir)) {
    if (!RUNTIME_SKILLS.has(name)) continue;
    const skillPath = join(skillsDir, name, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    const content = readFileSync(skillPath, 'utf8');
    if (/\$\{CLAUDE_PLUGIN_ROOT\}|\$\{PLUGIN_ROOT\}/.test(content)) {
      issues.push(`${name}: plugin-root placeholder remains`);
      continue;
    }
    if (content.includes(sourceRuntimeCommand)) continue;
    const localPaths = localRuntimePaths(content);
    if (localPaths.length > 0) {
      if (localPaths.every(existsSync)) continue;
      issues.push(`${name}: local runtime tree is missing`);
      continue;
    }
    issues.push(`${name}: runtime prefix or local runtime tree is missing`);
  }

  if (issues.length > 0) {
    return { pass: false, message: `${issues.join('; ')}; reinstall or upgrade spec-superflow instead of editing skill files manually` };
  }
  return { pass: true, message: `${PLATFORM_RUNTIME_INVENTORY.length} platforms inventoried; canonical skills and local runtime are resolvable` };
}

function checkDist(root) {
  const distDir = join(root, 'dist');
  if (!existsSync(distDir)) {
    return { pass: false, message: 'dist/ not found (run npm run build)' };
  }
  const indexJs = join(distDir, 'index.js');
  if (!existsSync(indexJs)) {
    return { pass: false, message: 'dist/index.js not found' };
  }
  return { pass: true, message: 'compiled' };
}

function checkRootPluginAuthor(root) {
  const pluginPath = join(root, 'plugin.json');
  const plugin = readJsonIfExists(pluginPath);
  if (!plugin) {
    return { pass: false, message: 'plugin.json not found' };
  }
  if (!plugin.author) {
    return { pass: false, message: 'missing author field' };
  }
  if (typeof plugin.author === 'string') {
    return { pass: false, message: 'author must be an object (got string)' };
  }
  if (typeof plugin.author === 'object' && !Array.isArray(plugin.author) && plugin.author.name) {
    return { pass: true, message: `author.name = ${plugin.author.name}` };
  }
  return { pass: false, message: 'author object must contain a name property' };
}

function checkNodeVersion(version = process.version) {
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major >= 20) {
    return { pass: true, message: version };
  }
  return { pass: false, message: `${version} (requires >= 20)` };
}

function checkDocs(root) {
  const warnings = [];
  const pkg = readJsonIfExists(join(root, 'package.json'));
  if (!pkg) return { pass: true, message: 'skipped (no package.json)' };

  const pkgVersion = pkg.version;

  // Check CHANGELOG has current version
  const changelogPath = join(root, 'CHANGELOG.md');
  if (existsSync(changelogPath)) {
    const changelog = readFileSync(changelogPath, 'utf-8');
    if (!changelog.includes(`## [${pkgVersion}]`)) {
      warnings.push(`CHANGELOG.md missing entry for v${pkgVersion}`);
    }
  }

  // Check skills count in README
  const readmePath = join(root, 'README.md');
  if (existsSync(readmePath)) {
    const skillsDir = join(root, 'skills');
    if (existsSync(skillsDir)) {
      const actualSkills = readdirSync(skillsDir).filter(f => {
        try { return statSync(join(skillsDir, f)).isDirectory(); } catch { return false; }
      }).length;
      const readme = readFileSync(readmePath, 'utf-8');
      // Count skill table rows (pattern: | N | `skill-name` | where N is a row number)
      const skillRefs = readme.match(/\|\s*\d+\s*\|\s*`[a-z-]+`/g) || [];
      if (skillRefs.length > 0 && skillRefs.length !== actualSkills) {
        warnings.push(`README lists ${skillRefs.length} skills, but skills/ has ${actualSkills}`);
      }
    }
  }

  if (warnings.length === 0) {
    return { pass: true, message: 'consistent' };
  }
  return { pass: false, message: warnings.join('; ') };
}

export async function run(args) {
  const root = process.cwd();
  const config = loadConfig(root);

  console.log('spec-superflow doctor:\n');

  const checks = [
    ['Version', checkVersionConsistency(root)],
    ['Root plugin author', checkRootPluginAuthor(root)],
    ['Hooks', checkHooks(root)],
    ['Codex manifest', checkCodexManifest(root)],
    ['Skills', checkSkills(root)],
    ['Runtime distribution', checkRuntimeDistribution(root)],
    ['dist/', checkDist(root)],
    ['Node.js', checkNodeVersion()],
    ['Docs', checkDocs(root)],
  ];

  // Config check
  const configPath = join(root, 'spec-superflow.config.json');
  if (existsSync(configPath)) {
    try {
      JSON.parse(readFileSync(configPath, 'utf-8'));
      checks.push(['Config', { pass: true, message: 'valid JSON' }]);
    } catch (e) {
      checks.push(['Config', { pass: false, message: `invalid JSON: ${e.message}` }]);
    }
  }

  let hasFailure = false;
  for (const [name, result] of checks) {
    const icon = result.pass ? '✅' : '⚠️ ';
    console.log(`  ${icon} ${name}: ${result.message}`);
    if (!result.pass) hasFailure = true;
  }

  console.log('');
  if (hasFailure) {
    console.log('⚠️  Some checks need attention.');
  } else {
    console.log('✅ All checks passed.');
  }
}

export { checkVersionConsistency, checkHooks, checkCodexManifest, checkSkills, checkRuntimeDistribution, checkDist, checkRootPluginAuthor, checkNodeVersion, checkDocs };
