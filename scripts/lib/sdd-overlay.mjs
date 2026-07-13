import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { computeArtifactsHash } from './hash.mjs';
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
    reviews: join(root, 'reviews'),
  };
}

export function computeTaskHash(changeDir, taskId) {
  const tasks = readFileSync(join(changeDir, 'tasks.md'), 'utf8');
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tasks.match(new RegExp(`^- \\[([ xX])\\] ${escaped}\\s+.+$`, 'm'));
  if (!match) throw new Error(`Task '${taskId}' was not found in tasks.md`);
  return `sha256:${createHash('sha256').update(match[0]).digest('hex')}`;
}

export function saveCheckpoint(changeDir, input) {
  requireText(input?.taskId, 'taskId');
  requireText(input?.next, 'next');
  const paths = getOverlayPaths(changeDir);
  mkdirSync(paths.checkpoints, { recursive: true });
  const record = {
    task_id: input.taskId,
    task_hash: computeTaskHash(changeDir, input.taskId),
    next: input.next,
    completed: input.completed ?? 'Not recorded',
    evidence: input.evidence ?? 'Not recorded',
    review: input.review ?? 'Not recorded',
    risk: input.risk ?? 'Not recorded',
    commit_start: input.commitStart ?? 'Not recorded',
    commit_end: input.commitEnd ?? 'Not recorded',
    created_at: new Date().toISOString(),
  };
  const targetPath = join(paths.checkpoints, `${safeName(input.taskId)}.md`);
  atomicWrite(targetPath, renderRecord(record, `# Checkpoint: ${input.taskId}`, checkpointBody(record)));
  return readCheckpoint(targetPath);
}

export function listCheckpoints(changeDir) {
  const directory = getOverlayPaths(changeDir).checkpoints;
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => name.endsWith('.md')).sort()
    .map(name => readCheckpoint(join(directory, name)));
}

export function getCheckpoint(changeDir, taskId) {
  const filePath = join(getOverlayPaths(changeDir).checkpoints, `${safeName(taskId)}.md`);
  if (!existsSync(filePath)) return null;
  return readCheckpoint(filePath);
}

export function createHandoff(changeDir, input) {
  requireText(input?.type, 'type');
  if (!HANDOFF_TYPES.has(input.type)) throw new Error(`Unsupported handoff type '${input.type}'`);
  requireText(input?.title, 'title');
  requireText(input?.question, 'question');
  const paths = getOverlayPaths(changeDir);
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
  atomicWrite(join(directory, 'HANDOFF.md'), renderRecord(
    metadata,
    `# Handoff: ${input.title}`,
    handoffBody(metadata),
  ));
  atomicWrite(join(directory, HANDOFF_RESULT_FILE), renderResultTemplate());
  return readHandoff(directory);
}

export function listHandoffs(changeDir) {
  const directory = getOverlayPaths(changeDir).handoffs;
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => readHandoff(join(directory, entry.name)));
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

function readCheckpoint(filePath) {
  const { metadata } = parseRecord(readFileSync(filePath, 'utf8'));
  metadata.commit_start ??= 'Not recorded';
  metadata.commit_end ??= 'Not recorded';
  let currentHash;
  try {
    currentHash = computeTaskHash(dirname(dirname(dirname(dirname(filePath)))), metadata.task_id);
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
  const directory = join(getOverlayPaths(changeDir).handoffs, safeName(id));
  if (!existsSync(join(directory, 'HANDOFF.md'))) return null;
  const { metadata } = parseRecord(readFileSync(join(directory, 'HANDOFF.md'), 'utf8'));
  return { ...metadata, directory, metadata };
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
