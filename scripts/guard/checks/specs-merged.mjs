// scripts/guard/checks/specs-merged.mjs — block closing while delta specs are unmerged
import { readState } from '../../lib/state-loader.mjs';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validatePublicationReceipt } from '../../lib/spec-publication.mjs';

// A delta spec block is introduced by any of these requirement headers.
const DELTA_RE = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements/m;

function collectSpecFiles(specsDir) {
  const out = [];
  const entries = readdirSync(specsDir, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && /\.(md|markdown)$/i.test(e.name)) {
      // With recursive readdir, e.parentPath gives the directory.
      const dir = typeof e.parentPath === 'string' ? e.parentPath : specsDir;
      out.push(join(dir, e.name));
    }
  }
  return out;
}

function hasDeltaSpecs(changeDir) {
  const specsDir = join(changeDir, 'specs');
  if (!existsSync(specsDir)) return false;
  for (const file of collectSpecFiles(specsDir)) {
    const content = readFileSync(file, 'utf-8');
    if (DELTA_RE.test(content)) return true;
  }
  return false;
}

/**
 * Returns { pass, failures[] }.
 * Passes when there are no delta specs, or a receipt proves that the current
 * active change still matches its published root baseline. `spec_merged` is a
 * compatibility marker only: it cannot prove which delta or baseline it meant.
 */
export function checkSpecsMerged(changeDir) {
  const state = readState(changeDir);
  if (!hasDeltaSpecs(changeDir)) {
    return { pass: true, failures: [] };
  }
  const receipt = validatePublicationReceipt(changeDir, state.spec_publication_receipt);
  if (receipt.pass) return { pass: true, failures: [] };
  return {
    pass: false,
    failures: [
      `Delta specs require a current publication receipt before closing. ${receipt.reason} Run ssf sync <change-dir> again.`,
    ],
  };
}
