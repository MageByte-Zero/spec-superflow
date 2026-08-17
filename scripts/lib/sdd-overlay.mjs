import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { computeArtifactsHash, normalizeTaskCheckboxes } from './hash.mjs';
import { readState } from './state-loader.mjs';

export const HANDOFF_TYPES = new Set(['prototype', 'research', 'experiment']);
export const HANDOFF_DECISIONS = new Set(['accept', 'reject', 'defer']);
export const RESULT_HEADINGS = [
  'Conclusion', 'Evidence', 'Produced Artifacts', 'Risks', 'Suggested Changes',
];
const HANDOFF_RESULT_FILE = 'HANDOFF_RESULT.md';

export function getOverlayPaths(changeDir) {
  const root = join(changeDir, '.superpowers', 'sdd');
  return {
    root,
    checkpoints: join(root, 'checkpoints'),
    handoffs: join(root, 'handoffs'),
    executionPlan: join(root, 'execution-plan.json'),
    executionRecommendation: join(root, 'execution-recommendation.json'),
    workflowSelection: join(root, 'workflow-selection.json'),
    reviews: join(root, 'reviews'),
  };
}

/**
 * Resolves the mutable execution workspace for one persisted plan. Root-level
 * plan/selection files intentionally stay in getOverlayPaths() so callers can
 * find the current plan before resolving this scope.
 */
export function getPlanScopedPaths(changeDir, plan) {
  const rootPaths = getOverlayPaths(changeDir);
  const planIdentity = getPlanIdentity(plan);
  const planRoot = join(rootPaths.root, 'plans', planIdentity);
  return {
    root: rootPaths.root,
    planIdentity,
    identity: planIdentity,
    planRoot,
    workspace: join(planRoot, 'workspace'),
    checkpoints: join(planRoot, 'checkpoints'),
    handoffs: join(planRoot, 'handoffs'),
    reviews: join(planRoot, 'reviews'),
    repairState: join(planRoot, 'repair-state'),
    adjudications: join(planRoot, 'adjudications'),
  };
}

/**
 * Reads the root control plan and delegates all mutable-path derivation to
 * getPlanScopedPaths(). It returns null before execution planning exists so
 * legacy checkpoint and handoff commands retain their established behavior.
 */
export function getCurrentPlanScopedPaths(changeDir) {
  const planPath = getOverlayPaths(changeDir).executionPlan;
  if (!existsSync(planPath)) return null;
  let plan;
  try {
    plan = JSON.parse(readFileSync(planPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read execution plan for SDD workspace: ${error.message}`);
  }
  return { plan, ...getPlanScopedPaths(changeDir, plan) };
}

export function computeTaskHash(changeDir, taskId) {
  const tasks = readFileSync(join(changeDir, 'tasks.md'), 'utf8');
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tasks.match(new RegExp(`^- \\[([ xX])\\] ${escaped}\\s+.+$`, 'm'));
  if (!match) throw new Error(`Task '${taskId}' was not found in tasks.md`);
  return `sha256:${createHash('sha256').update(normalizeTaskCheckboxes(match[0])).digest('hex')}`;
}

export function saveCheckpoint(changeDir, input) {
  requireText(input?.taskId, 'taskId');
  requireText(input?.next, 'next');
  const taskHash = computeTaskHash(changeDir, input.taskId);
  const currentScope = getCurrentPlanScopedPaths(changeDir);
  const paths = currentScope ?? getOverlayPaths(changeDir);
  mkdirSync(paths.checkpoints, { recursive: true });
  const record = {
    task_id: input.taskId,
    task_hash: taskHash,
    next: input.next,
    completed: input.completed ?? 'Not recorded',
    evidence: input.evidence ?? 'Not recorded',
    review: input.review ?? 'Not recorded',
    risk: input.risk ?? 'Not recorded',
    commit_start: input.commitStart ?? 'Not recorded',
    commit_end: input.commitEnd ?? 'Not recorded',
    created_at: new Date().toISOString(),
  };
  if (currentScope) {
    record.plan_hash = currentScope.plan.hash;
    record.plan_revision = currentScope.plan.revision;
  }
  const targetPath = join(paths.checkpoints, `${safeName(input.taskId)}.md`);
  atomicWrite(targetPath, renderRecord(record, `# Checkpoint: ${input.taskId}`, checkpointBody(record)));
  return { ...record, stale: false };
}

export function listCheckpoints(changeDir) {
  const { directory, legacyPlan } = resolveRecordDirectory(changeDir, 'checkpoints');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => name.endsWith('.md')).sort()
    .map(name => readCheckpoint(join(directory, name), changeDir))
    .filter(checkpoint => !legacyPlan || hasMatchingPlan(checkpoint, legacyPlan));
}

export function getCheckpoint(changeDir, taskId) {
  const { directory, legacyPlan } = resolveRecordDirectory(changeDir, 'checkpoints');
  const filePath = join(directory, `${safeName(taskId)}.md`);
  if (!existsSync(filePath)) return null;
  const checkpoint = readCheckpoint(filePath, changeDir);
  return legacyPlan && !hasMatchingPlan(checkpoint, legacyPlan) ? null : checkpoint;
}

export function createHandoff(changeDir, input) {
  requireText(input?.type, 'type');
  if (!HANDOFF_TYPES.has(input.type)) throw new Error(`Unsupported handoff type '${input.type}'`);
  requireText(input?.title, 'title');
  requireText(input?.question, 'question');
  const currentScope = getCurrentPlanScopedPaths(changeDir);
  const paths = currentScope ?? getOverlayPaths(changeDir);
  const id = input.id || `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const directory = join(paths.handoffs, safeName(id));
  mkdirSync(directory, { recursive: true });
  const state = readState(changeDir);
  const metadata = {
    id,
    type: input.type,
    title: input.title,
    question: input.question,
    context: input.context ?? 'Not recorded',
    source: input.source ?? 'Not recorded',
    core_state: state.state,
    state: state.state,
    source_artifacts_hash: computeArtifactsHash(changeDir),
    status: 'active',
    created_at: new Date().toISOString(),
  };
  if (currentScope) {
    metadata.plan_hash = currentScope.plan.hash;
    metadata.plan_revision = currentScope.plan.revision;
  }
  atomicWrite(join(directory, 'HANDOFF.md'), renderRecord(
    metadata,
    `# Handoff: ${input.title}`,
    handoffBody(metadata),
  ));
  atomicWrite(join(directory, HANDOFF_RESULT_FILE), renderResultTemplate());
  return readHandoff(directory);
}

export function listHandoffs(changeDir) {
  const { directory, legacyPlan } = resolveRecordDirectory(changeDir, 'handoffs');
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => readHandoff(join(directory, entry.name)))
    .filter(handoff => !legacyPlan || hasMatchingPlan(handoff, legacyPlan));
}

export function finishHandoff(changeDir, id) {
  const handoff = getHandoff(changeDir, id);
  if (!handoff) throw new Error(`Handoff '${id}' was not found`);
  const resultPath = join(handoff.directory, HANDOFF_RESULT_FILE);
  const result = parseResult(readFileSync(resultPath, 'utf8'));
  for (const heading of RESULT_HEADINGS) {
    if (!result[heading]) throw new Error(`${heading} must contain non-empty content`);
  }
  if (handoff.status !== 'active') throw new Error(`Handoff '${id}' is not active`);
  const metadata = { ...handoff.metadata, status: 'result-ready', result_ready_at: new Date().toISOString() };
  atomicWrite(join(handoff.directory, 'HANDOFF.md'), renderRecord(
    metadata,
    `# Handoff: ${metadata.title}`,
    handoffBody(metadata),
  ));
  return readHandoff(handoff.directory);
}

export function resolveHandoff(changeDir, id, decision, acknowledgeSourceDrift) {
  if (!HANDOFF_DECISIONS.has(decision)) throw new Error(`Unsupported handoff decision '${decision}'`);
  const handoff = getHandoff(changeDir, id);
  if (!handoff) throw new Error(`Handoff '${id}' was not found`);
  if (handoff.status !== 'result-ready') throw new Error(`Handoff '${id}' is not result-ready`);
  const sourceDrift = handoff.source_artifacts_hash !== computeArtifactsHash(changeDir);
  if (sourceDrift && acknowledgeSourceDrift !== true) {
    throw new Error('resolve requires acknowledge-source-drift');
  }
  const metadata = {
    ...handoff.metadata,
    status: 'resolved',
    decision,
    resolved_at: new Date().toISOString(),
    source_drift: sourceDrift,
    source_drift_acknowledged: sourceDrift && acknowledgeSourceDrift === true,
  };
  atomicWrite(join(handoff.directory, 'HANDOFF.md'), renderRecord(
    metadata,
    `# Handoff: ${metadata.title}`,
    handoffBody(metadata),
  ));
  return readHandoff(handoff.directory);
}

function checkpointBody(record) {
  return [
    `## Next\n${record.next}`,
    `## Completed\n${record.completed}`,
    `## Evidence\n${record.evidence}`,
    `## Review\n${record.review}`,
    `## Risk\n${record.risk}`,
    `## Commit Start\n${record.commit_start}`,
    `## Commit End\n${record.commit_end}`,
  ].join('\n\n');
}

function handoffBody(metadata) {
  return [
    `## Question\n${metadata.question}`,
    `## Context\n${metadata.context}`,
    `## Source\n${metadata.source}`,
  ].join('\n\n');
}

function renderResultTemplate() {
  return `${RESULT_HEADINGS.map(heading => `## ${heading}\n`).join('\n')}\n`;
}

function readCheckpoint(filePath, changeDir) {
  const { metadata } = parseRecord(readFileSync(filePath, 'utf8'));
  metadata.commit_start ??= 'Not recorded';
  metadata.commit_end ??= 'Not recorded';
  let currentHash;
  try {
    currentHash = computeTaskHash(changeDir, metadata.task_id);
  } catch (error) {
    if (error instanceof Error && error.message === `Task '${metadata.task_id}' was not found in tasks.md`) {
      return { ...metadata, stale: true };
    }
    throw error;
  }
  return { ...metadata, stale: metadata.task_hash !== currentHash };
}

function readHandoff(directory) {
  const { metadata } = parseRecord(readFileSync(join(directory, 'HANDOFF.md'), 'utf8'));
  return { ...metadata, directory };
}

function getHandoff(changeDir, id) {
  const { directory: handoffsDirectory, legacyPlan } = resolveRecordDirectory(changeDir, 'handoffs');
  const directory = join(handoffsDirectory, safeName(id));
  if (!existsSync(join(directory, 'HANDOFF.md'))) return null;
  const { metadata } = parseRecord(readFileSync(join(directory, 'HANDOFF.md'), 'utf8'));
  if (legacyPlan && !hasMatchingPlan(metadata, legacyPlan)) return null;
  return { ...metadata, directory, metadata };
}

function getPlanIdentity(plan) {
  if (typeof plan?.hash !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(plan.hash)) {
    throw new Error('Execution plan hash must be a sha256 digest');
  }
  if (!Number.isSafeInteger(plan?.revision) || plan.revision < 1) {
    throw new Error('Execution plan revision must be a positive integer');
  }
  return `r${plan.revision}-${plan.hash.slice('sha256:'.length).toLowerCase()}`;
}

function resolveRecordDirectory(changeDir, field) {
  let currentScope;
  try {
    currentScope = getCurrentPlanScopedPaths(changeDir);
  } catch {
    // Recovery surfaces report malformed execution plans themselves. Keep the
    // established checkpoint/handoff reads available so that diagnostic can be
    // surfaced instead of being masked by an overlay parsing exception.
    return { directory: getOverlayPaths(changeDir)[field], legacyPlan: null };
  }
  if (!currentScope) return { directory: getOverlayPaths(changeDir)[field], legacyPlan: null };
  // A plan scope is the cutover marker. Once it exists, never mix flat
  // records into the current plan even if this particular subdirectory is
  // empty or has been regenerated.
  if (existsSync(currentScope.planRoot)) {
    return { directory: currentScope[field], legacyPlan: null };
  }
  return { directory: getOverlayPaths(changeDir)[field], legacyPlan: currentScope.plan };
}

function hasMatchingPlan(record, plan) {
  return record?.plan_hash === plan.hash
    && String(record?.plan_revision) === String(plan.revision);
}

function renderRecord(metadata, title, body) {
  const frontmatter = Object.entries(metadata)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');
  return `---\n${frontmatter}\n---\n\n${title}\n\n${body}\n`;
}

function parseRecord(content) {
  const lines = content.split('\n');
  if (lines[0] !== '---') throw new Error('Record is missing frontmatter');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('Record frontmatter is not closed');
  const metadata = {};
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!match) continue;
    metadata[match[1]] = parseScalar(match[2]);
  }
  return { metadata, body: lines.slice(end + 1).join('\n') };
}

function parseScalar(value) {
  if (value.startsWith('"')) {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function parseResult(content) {
  const result = {};
  let currentHeading = null;
  for (const line of content.split('\n')) {
    const heading = line.match(/^## (.+?)\s*$/)?.[1];
    if (heading && RESULT_HEADINGS.includes(heading)) {
      currentHeading = heading;
      result[currentHeading] = '';
    } else if (currentHeading) {
      result[currentHeading] += `${line}\n`;
    }
  }
  for (const heading of RESULT_HEADINGS) result[heading] = result[heading]?.trim() || '';
  return result;
}

function atomicWrite(targetPath, content) {
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tempPath, content, 'utf8');
  renameSync(tempPath, targetPath);
}

function requireText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
}

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '_');
}
