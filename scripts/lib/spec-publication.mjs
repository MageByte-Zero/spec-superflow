// Shared publication seam: an active change's delta specs are applied to the
// project's published baseline and verified later by the closing guard.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  extractRequirementsSection,
  parseDeltaSpec,
  Validator,
} from '../../dist/index.js';
import { findCanonicalSpecFiles, relativeSpecPath, validateSpecPathLayout } from './spec-paths.mjs';

const DELTA_HEADER_RE = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/im;
const RECEIPT_VERSION = 1;

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function digest(entries) {
  const hash = createHash('sha256');
  for (const [name, content] of [...entries].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(name);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function capabilityFromSpecFile(changeDir, file) {
  const parts = relative(join(changeDir, 'specs'), file).split(/[/\\]/);
  return parts[0];
}

function targetPath(projectRoot, capability) {
  return join(projectRoot, 'specs', capability, 'spec.md');
}

function requirementIndex(blocks, name) {
  return blocks.findIndex(block => block.name === name);
}

function normalizeNearRequirementName(name) {
  return name.toLocaleLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, '');
}

function assertNoNearRequirementMatch(blocks, name, operation) {
  const normalized = normalizeNearRequirementName(name);
  const nearMatch = blocks.find(block =>
    block.name !== name && normalizeNearRequirementName(block.name) === normalized
  );
  if (nearMatch) {
    throw new Error(
      `Cannot ${operation} requirement '${name}' in published baseline: it is a near-match for existing requirement '${nearMatch.name}'. Use the exact published requirement name.`,
    );
  }
}

function sameRequirement(left, right) {
  return left.raw.trimEnd() === right.raw.trimEnd();
}

function openingFence(line) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  return match ? { marker: match[1][0], length: match[1].length } : undefined;
}

function closesFence(line, fence) {
  const match = line.match(/^ {0,3}(`+|~+)\s*$/);
  return Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length);
}

/** Extract a top-level purpose without treating Markdown examples as structure. */
function extractPurpose(content) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  let activeFence;
  let start = -1;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (activeFence) {
      if (closesFence(line, activeFence)) activeFence = undefined;
      continue;
    }
    const fence = openingFence(line);
    if (fence) {
      activeFence = fence;
      continue;
    }
    if (/^##\s+Purpose\s*$/i.test(line)) {
      start = index + 1;
      break;
    }
  }

  if (start === -1) return '';
  activeFence = undefined;
  const purpose = [];
  for (let index = start; index < lines.length; index++) {
    const line = lines[index];
    if (activeFence) {
      purpose.push(line);
      if (closesFence(line, activeFence)) activeFence = undefined;
      continue;
    }
    const fence = openingFence(line);
    if (fence) {
      activeFence = fence;
      purpose.push(line);
      continue;
    }
    if (/^##\s+/.test(line)) break;
    purpose.push(line);
  }
  return purpose.join('\n').trim();
}

function defaultPurpose(capability) {
  return `The ${capability} capability documents the published behavior for users and maintainers.`;
}

function withCanonicalPurpose(before, capability, deltaContent, warnings, isNewBaseline) {
  if (!isNewBaseline || extractPurpose(before)) return before.trimEnd();
  const purpose = extractPurpose(deltaContent) || defaultPurpose(capability);
  if (!extractPurpose(deltaContent)) {
    warnings.push(`No delta Purpose was supplied for '${capability}'; a deterministic default Purpose was used.`);
  }
  return `${before.trimEnd() || `# ${capability}`}\n\n## Purpose\n\n${purpose}`;
}

function validateDeltaOrThrow(deltaContent) {
  const report = new Validator().validateDeltaSpec(deltaContent);
  if (!report.valid) {
    throw new Error(`Invalid delta spec: ${report.issues.map(issue => issue.message).join('; ')}`);
  }
}

function renderCanonicalBaseline(parts, capability) {
  const before = parts.before.trimEnd() || `# ${capability}`;
  const preamble = parts.preamble.trim();
  const blocks = parts.bodyBlocks.map(block => block.raw.trim()).filter(Boolean).join('\n\n');
  const after = parts.after.trim();
  const sections = [before, '## Requirements'];
  if (preamble) sections.push(preamble);
  if (blocks) sections.push(blocks);
  if (after) sections.push(after);
  return `${sections.join('\n\n').trimEnd()}\n`;
}

function baselineParts(content, capability) {
  if (!content) {
    return { before: `# ${capability}`, preamble: '', bodyBlocks: [], after: '' };
  }

  if (!DELTA_HEADER_RE.test(content)) {
    const parts = extractRequirementsSection(content);
    return { ...parts, headerLine: '## Requirements' };
  }

  const plan = parseDeltaSpec(content);
  if (plan.removed.length > 0 || plan.renamed.length > 0) {
    throw new Error(
      `Cannot safely normalize legacy delta baseline for '${capability}' containing REMOVED or RENAMED operations. Restore a canonical baseline before syncing.`,
    );
  }
  const firstDelta = content.search(/^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/im);
  const before = content.slice(0, firstDelta).trimEnd() || `# ${capability}`;
  const blocks = [...plan.added, ...plan.modified];
  const names = new Set();
  for (const block of blocks) {
    if (names.has(block.name)) {
      throw new Error(`Cannot normalize legacy delta baseline for '${capability}': duplicate requirement '${block.name}'.`);
    }
    names.add(block.name);
  }
  return { before, preamble: '', bodyBlocks: blocks, after: '' };
}

/**
 * Apply one delta spec and return a publication candidate plus an auditable
 * description of which delta operations changed it. This is intentionally
 * separate from the established string-returning public wrapper below.
 */
export function applyDeltaToBaselineDetailed(baselineContent, deltaContent, capability) {
  validateDeltaOrThrow(deltaContent);
  const isNewBaseline = !baselineContent.trim();
  const parts = baselineParts(baselineContent, capability);
  const blocks = [...parts.bodyBlocks];
  const plan = parseDeltaSpec(deltaContent);
  const operations = [];
  const warnings = [];

  for (const { from, to } of plan.renamed) {
    const fromIndex = requirementIndex(blocks, from);
    const toIndex = requirementIndex(blocks, to);
    if (fromIndex === -1) {
      assertNoNearRequirementMatch(blocks, from, 'rename');
      if (toIndex !== -1) {
        operations.push({ operation: 'RENAMED', status: 'skipped' });
        continue;
      }
      throw new Error(`Cannot rename missing requirement '${from}' in '${capability}'.`);
    }
    assertNoNearRequirementMatch(blocks, to, 'rename to');
    if (toIndex !== -1) throw new Error(`Cannot rename '${from}' to existing requirement '${to}' in '${capability}'.`);
    const original = blocks[fromIndex];
    blocks[fromIndex] = {
      ...original,
      name: to,
      headerLine: `### Requirement: ${to}`,
      raw: `### Requirement: ${to}${original.raw.slice(original.headerLine.length)}`,
    };
    operations.push({ operation: 'RENAMED', status: 'applied' });
  }

  for (const block of plan.modified) {
    const index = requirementIndex(blocks, block.name);
    if (index === -1) {
      assertNoNearRequirementMatch(blocks, block.name, 'modify');
      throw new Error(`Cannot modify missing requirement '${block.name}' in '${capability}'.`);
    }
    if (sameRequirement(blocks[index], block)) {
      operations.push({ operation: 'MODIFIED', status: 'skipped' });
    } else {
      blocks[index] = block;
      operations.push({ operation: 'MODIFIED', status: 'applied' });
    }
  }

  for (const name of plan.removed) {
    const index = requirementIndex(blocks, name);
    if (index === -1) {
      assertNoNearRequirementMatch(blocks, name, 'remove');
      operations.push({ operation: 'REMOVED', status: 'skipped' });
    } else {
      blocks.splice(index, 1);
      operations.push({ operation: 'REMOVED', status: 'applied' });
    }
  }

  for (const block of plan.added) {
    const index = requirementIndex(blocks, block.name);
    if (index !== -1 && sameRequirement(blocks[index], block)) {
      operations.push({ operation: 'ADDED', status: 'skipped' });
      continue;
    }
    assertNoNearRequirementMatch(blocks, block.name, 'add');
    if (index !== -1) {
      throw new Error(`Cannot add existing requirement '${block.name}' in '${capability}'.`);
    }
    blocks.push(block);
    operations.push({ operation: 'ADDED', status: 'applied' });
  }

  const before = withCanonicalPurpose(parts.before, capability, deltaContent, warnings, isNewBaseline);
  const content = renderCanonicalBaseline({ ...parts, before, bodyBlocks: blocks }, capability);
  return {
    content,
    changed: content !== baselineContent,
    operations,
    warnings,
  };
}

/** Apply one delta spec to a canonical baseline and return canonical Markdown. */
export function applyDeltaToBaseline(baselineContent, deltaContent, capability) {
  return applyDeltaToBaselineDetailed(baselineContent, deltaContent, capability).content;
}

export function resolvePublicationContext(changeDir) {
  const absoluteChangeDir = resolve(changeDir);
  const changesDir = dirname(absoluteChangeDir);
  const projectRoot = basename(changesDir) === 'changes' ? dirname(changesDir) : dirname(absoluteChangeDir);
  return {
    changeDir: absoluteChangeDir,
    projectRoot,
    baselineSpecsDir: join(projectRoot, 'specs'),
  };
}

export function publicationCapabilities(changeDir, specFiles = findCanonicalSpecFiles(changeDir)) {
  return [...new Set(specFiles.map(file => capabilityFromSpecFile(changeDir, file)))].sort();
}

export function hashChangeDelta(changeDir, specFiles = findCanonicalSpecFiles(changeDir)) {
  return digest(specFiles.map(file => [relativeSpecPath(changeDir, file), readFileSync(file, 'utf-8')]));
}

export function hashPublishedBaseline(projectRoot, capabilities) {
  return digest(capabilities.map(capability => {
    const file = targetPath(projectRoot, capability);
    return [toPosix(relative(projectRoot, file)), existsSync(file) ? readFileSync(file, 'utf-8') : '<missing>'];
  }));
}

export function encodePublicationReceipt(receipt) {
  return Buffer.from(JSON.stringify(receipt), 'utf-8').toString('base64url');
}

export function decodePublicationReceipt(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function createPublicationReceipt(changeDir, projectRoot, specFiles, baselineBeforeHash) {
  const capabilities = publicationCapabilities(changeDir, specFiles);
  return {
    version: RECEIPT_VERSION,
    source_hash: hashChangeDelta(changeDir, specFiles),
    baseline_before_hash: baselineBeforeHash,
    baseline_after_hash: hashPublishedBaseline(projectRoot, capabilities),
    capabilities,
  };
}

/** Return deterministic receipt validation used by the closing guard. */
export function validatePublicationReceipt(changeDir, encodedReceipt) {
  const receipt = decodePublicationReceipt(encodedReceipt);
  if (!receipt || receipt.version !== RECEIPT_VERSION || !Array.isArray(receipt.capabilities)) {
    return { pass: false, reason: 'Publication receipt is missing or invalid.' };
  }
  const layout = validateSpecPathLayout(changeDir, { requireSpecs: true });
  if (!layout.pass) return { pass: false, reason: layout.failures.join(' ') };
  const context = resolvePublicationContext(changeDir);
  const capabilities = publicationCapabilities(changeDir, layout.specFiles);
  if (JSON.stringify(capabilities) !== JSON.stringify([...receipt.capabilities].sort())) {
    return { pass: false, reason: 'Publication receipt capabilities no longer match the active change.' };
  }
  if (hashChangeDelta(changeDir, layout.specFiles) !== receipt.source_hash) {
    return { pass: false, reason: 'The active change delta has changed since publication.' };
  }
  if (hashPublishedBaseline(context.projectRoot, capabilities) !== receipt.baseline_after_hash) {
    return { pass: false, reason: 'The published baseline has changed since publication.' };
  }
  return { pass: true, reason: '' };
}
