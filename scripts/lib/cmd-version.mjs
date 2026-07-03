// ssf version <semver> — sync version to all manifest and documentation files
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── JSON manifests with structured path ──
const MANIFESTS = [
  { file: 'package.json', path: ['version'] },
  { file: 'plugin.json', path: ['version'] },
  { file: '.claude-plugin/plugin.json', path: ['version'] },
  { file: '.claude-plugin/marketplace.json', path: ['plugins', '0', 'version'] },
  { file: '.cursor-plugin/plugin.json', path: ['version'] },
  { file: '.cursor-plugin/marketplace.json', path: ['metadata', 'version'] },
  { file: '.codex-plugin/plugin.json', path: ['version'] },
  { file: 'gemini-extension.json', path: ['version'] },
  { file: '.github/plugin/marketplace.json', path: ['metadata', 'version'] },
  { file: '.github/plugin/marketplace.json', path: ['plugins', '0', 'version'] },
];

// ── Text files with regex patterns (first capture group = version to replace) ──
const TEXT_FILES = [
  { file: 'CLAUDE.md',              pattern: /(Current version: `)0\.\d+\.\d+(`\.)/g,            replacement: '$10.%MINOR%.%PATCH%$2' },
  { file: 'README.md',              pattern: /(当前版本：`v?)0\.\d+\.\d+(`?)/g,                   replacement: '$10.%MINOR%.%PATCH%$2' },
  { file: 'INSTALL.md',             pattern: /(当前发布版本：\*\*v)0\.\d+\.\d+(\*\*)/g,            replacement: '$10.%MINOR%.%PATCH%$2' },
  { file: 'docs/README_en.md',      pattern: /(Current: `v)0\.\d+\.\d+(`)/g,                     replacement: '$10.%MINOR%.%PATCH%$2' },
  { file: 'hooks/session-start',    pattern: /(# v)0\.\d+\.\d+(: conditional injection)/g,       replacement: '$10.%MINOR%.%PATCH%$2' },
  { file: 'llms.txt',               pattern: /(Current version: v)0\.\d+\.\d+(\.)/g,             replacement: '$10.%MINOR%.%PATCH%$2' },
  { file: '.claude/always/phase-guard.md', pattern: /(# Phase Guard: v)0\.\d+\.\d+(\n?)/g,       replacement: '$10.%MINOR%.%PATCH%$2' },
  { file: 'GEMINI.md',              pattern: /(\*\*版本\*\*: v)0\.\d+\.\d+/g,                    replacement: '$10.%MINOR%.%PATCH%' },
];

function getNestedValue(obj, pathParts) {
  let val = obj;
  for (const p of pathParts) {
    if (val === undefined || val === null) return undefined;
    val = val[p];
  }
  return val;
}

function setNestedValue(obj, pathParts, value) {
  let target = obj;
  for (let i = 0; i < pathParts.length - 1; i++) {
    target = target[pathParts[i]];
  }
  target[pathParts[pathParts.length - 1]] = value;
}

export async function run(args) {
  const dryRun = args.includes('--dry-run');
  const semverArgs = args.filter(a => a !== '--dry-run');

  if (semverArgs.length < 1) {
    console.error('Usage: ssf version <semver> [--dry-run]');
    process.exit(2);
  }

  const newVersion = semverArgs[0];
  const match = newVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    console.error(`Invalid semver: ${newVersion}`);
    process.exit(2);
  }
  const [, , minor, patch] = match;

  console.log(`Version sync → ${newVersion}${dryRun ? ' (dry run)' : ''}\n`);
  let changed = 0;
  let unchanged = 0;
  let skipped = 0;

  // ── Phase 1: JSON manifests ──
  console.log('── JSON manifests ──');
  const seenFiles = new Set();
  for (const manifest of MANIFESTS) {
    const key = `${manifest.file}:${manifest.path.join('.')}`;
    if (seenFiles.has(key)) continue;
    seenFiles.add(key);

    const filePath = join(process.cwd(), manifest.file);
    if (!existsSync(filePath)) {
      console.log(`  ⏭️  ${manifest.file} — not found, skipping`);
      skipped++;
      continue;
    }

    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    const currentVersion = getNestedValue(content, manifest.path);

    if (currentVersion === newVersion) {
      console.log(`  ✅ ${manifest.file} [${manifest.path.join('.')}]: ${currentVersion} (unchanged)`);
      unchanged++;
    } else {
      console.log(`  📝 ${manifest.file} [${manifest.path.join('.')}]: ${currentVersion || 'N/A'} → ${newVersion}`);
      changed++;
      if (!dryRun) {
        setNestedValue(content, manifest.path, newVersion);
        writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n');
      }
    }
  }

  // ── Phase 2: Text files (regex) ──
  console.log('\n── Documentation & scripts ──');
  for (const entry of TEXT_FILES) {
    const filePath = join(process.cwd(), entry.file);
    if (!existsSync(filePath)) {
      console.log(`  ⏭️  ${entry.file} — not found, skipping`);
      skipped++;
      continue;
    }

    const content = readFileSync(filePath, 'utf-8');
    const replacement = entry.replacement
      .replace('%MINOR%', minor)
      .replace('%PATCH%', patch);

    const newContent = content.replace(entry.pattern, replacement);
    if (newContent === content) {
      console.log(`  ✅ ${entry.file}: no version pattern matched (may already be correct)`);
      unchanged++;
    } else {
      console.log(`  📝 ${entry.file}: version string updated`);
      changed++;
      if (!dryRun) {
        writeFileSync(filePath, newContent);
      }
    }
  }

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Changed: ${changed}  Unchanged: ${unchanged}  Skipped: ${skipped}`);
  if (dryRun) {
    console.log('\nDry run complete. Run without --dry-run to apply changes.');
  } else {
    console.log('\n✅ Version synced across all files. Remember to commit and update CHANGELOG.md.');
  }
}
