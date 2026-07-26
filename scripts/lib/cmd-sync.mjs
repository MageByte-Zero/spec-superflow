// ssf sync <change-dir> — publish a change delta as canonical root baseline specs.
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import path, { join } from 'node:path';
import { validateSpecPathLayout } from './spec-paths.mjs';
import {
  applyDeltaToBaseline,
  createPublicationReceipt,
  encodePublicationReceipt,
  hashPublishedBaseline,
  resolvePublicationContext,
} from './spec-publication.mjs';
import { readState, writeState } from './state-loader.mjs';

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function pathApiFor(...values) {
  return values.some(value => value.includes('\\')) ? path.win32 : path.posix;
}

export function deriveCapabilityDir(changeSpecsDir, specFile) {
  const api = pathApiFor(changeSpecsDir, specFile);
  const relative = toPosix(api.relative(changeSpecsDir, specFile));
  return relative.replace(/\/spec\.md$/, '');
}

export async function run(args) {
  if (args.length < 1) {
    console.error('Usage: ssf sync <change-dir>');
    process.exit(2);
  }

  const requestedChangeDir = args[0];
  if (!existsSync(requestedChangeDir)) {
    console.error(`Error: "${requestedChangeDir}" not found`);
    process.exit(2);
  }

  const context = resolvePublicationContext(requestedChangeDir);
  const { changeDir, projectRoot, baselineSpecsDir } = context;
  const { Validator } = await import('../../dist/index.js');
  const validator = new Validator();

  // Collect deltas from this project only. The active change path, not cwd,
  // establishes both the publication destination and conflict scope.
  const changesDir = join(projectRoot, 'changes');
  const allDeltas = [];
  if (existsSync(changesDir)) {
    for (const dir of readdirSync(changesDir)) {
      const dirPath = join(changesDir, dir);
      if (!statSync(dirPath).isDirectory()) continue;
      const layout = validateSpecPathLayout(dirPath, { requireSpecs: false });
      if (!layout.pass) {
        for (const failure of layout.failures) console.error(failure);
        process.exit(1);
      }
      for (const specFile of layout.specFiles) {
        allDeltas.push({ changeName: dir, content: readFileSync(specFile, 'utf-8') });
      }
    }
  }

  if (allDeltas.length > 0) {
    const conflictReport = validator.detectSyncConflicts(allDeltas);
    if (conflictReport.hasConflicts) {
      console.log('⚠️  Sync conflicts detected:\n');
      for (const conflict of conflictReport.conflicts) {
        console.log(`  Requirement: "${conflict.requirement}"`);
        console.log(`  Modified by: ${conflict.changes.join(', ')}\n`);
      }
      console.log('Resolve conflicts before syncing. Consider syncing changes one at a time.');
      process.exit(1);
    }
  }

  const layout = validateSpecPathLayout(changeDir, { requireSpecs: true });
  if (!layout.pass) {
    for (const failure of layout.failures) console.error(failure);
    process.exit(1);
  }

  const changeSpecsDir = join(changeDir, 'specs');
  const capabilities = layout.specFiles.map(specFile => deriveCapabilityDir(changeSpecsDir, specFile)).sort();
  const baselineBeforeHash = hashPublishedBaseline(projectRoot, capabilities);
  mkdirSync(baselineSpecsDir, { recursive: true });

  for (const specFile of layout.specFiles) {
    const capabilityDir = deriveCapabilityDir(changeSpecsDir, specFile);
    const targetDir = join(baselineSpecsDir, capabilityDir);
    const targetFile = join(targetDir, 'spec.md');
    const baseline = existsSync(targetFile) ? readFileSync(targetFile, 'utf-8') : '';
    const delta = readFileSync(specFile, 'utf-8');
    const published = applyDeltaToBaseline(baseline, delta, capabilityDir);
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(targetFile, published);
    console.log(`  📋 Published canonical baseline: specs/${capabilityDir}/spec.md`);
  }

  // A receipt belongs to the active change, never to the published baseline.
  // Older callers without a state file still get canonical publication but do
  // not gain a false closing proof.
  if (existsSync(join(changeDir, '.spec-superflow.yaml'))) {
    const state = readState(changeDir);
    const receipt = createPublicationReceipt(changeDir, projectRoot, layout.specFiles, baselineBeforeHash);
    state.spec_merged = true;
    state.spec_publication_receipt = encodePublicationReceipt(receipt);
    writeState(changeDir, state);
    console.log('  🧾 Wrote publication receipt to .spec-superflow.yaml');
  }

  console.log(`\n✅ Published ${layout.specFiles.length} canonical spec(s) from ${path.basename(changeDir)} to specs/`);
}
