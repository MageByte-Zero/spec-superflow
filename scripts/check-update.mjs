#!/usr/bin/env node
// scripts/check-update.mjs — compare local spec-superflow version with npm latest
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

function readLocalVersion() {
  const candidates = ['package.json', 'plugin.json'];
  for (const file of candidates) {
    const path = join(process.cwd(), file);
    if (existsSync(path)) {
      try {
        const json = JSON.parse(readFileSync(path, 'utf-8'));
        if (json.name === 'spec-superflow' && json.version) {
          return json.version;
        }
      } catch { /* ignore */ }
    }
  }
  return null;
}

function readInstalledPluginVersion() {
  // Try to detect the globally installed Claude Code plugin version
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return null;
  const pluginPaths = [
    join(home, '.claude', 'plugins', 'spec-superflow@spec-superflow', 'plugin.json'),
    join(home, '.claude', 'plugins', 'spec-superflow', 'plugin.json'),
  ];
  for (const path of pluginPaths) {
    if (existsSync(path)) {
      try {
        const json = JSON.parse(readFileSync(path, 'utf-8'));
        if (json.version) return json.version;
      } catch { /* ignore */ }
    }
  }
  return null;
}

function readNpmLatest() {
  try {
    const out = execFileSync('npm', ['view', 'spec-superflow', 'version'], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return out.trim();
  } catch {
    return null;
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function main() {
  const localVersion = readInstalledPluginVersion() || readLocalVersion();
  const latestVersion = readNpmLatest();

  if (!localVersion || !latestVersion) {
    console.log('⚠️  Could not determine local or latest version. Skipping update check.');
    process.exit(2);
  }

  const cmp = compareVersions(localVersion, latestVersion);
  if (cmp >= 0) {
    console.log(`✅ spec-superflow is up to date (${localVersion}).`);
    process.exit(0);
  }

  console.log(`⚠️  A new version of spec-superflow is available: ${latestVersion} (current: ${localVersion})`);
  console.log('');
  console.log('Upgrade commands:');
  console.log('  Claude Code: /plugin update spec-superflow@spec-superflow');
  console.log('  Cursor:      re-run the install-cursor.mjs script');
  console.log('  npm:         npm install -g spec-superflow@latest');
  process.exit(1);
}

main();
