import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { computeArtifactsHash, computeContractHash } from './hash.mjs';
import { readPlan, validatePlan } from './execution-plan.mjs';
import { getOverlayPaths, getPlanScopedPaths } from './sdd-overlay.mjs';
import { readState, writeState } from './state-loader.mjs';

const LEDGER_VERSION = 1;
const MINIMUM_FAILED_ATTEMPTS = 3;
const DECISIONS = new Set(['continue', 'abandon']);

export function recordDebugAttempt(changeDir, input) {
  requireSafeText(input?.id, 'id');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(input.id)) {
    throw new Error('Attempt id must contain only letters, numbers, dots, underscores, or hyphens');
  }
  requireSafeText(input?.summary, 'summary');
  requireSafeText(input?.evidence, 'evidence');

  const loaded = loadCurrentLedger(changeDir, { requireDebugging: true });
  if (loaded.ledger.escalation) {
    throw new Error('DP-5 is already recorded for the current debugging context');
  }
  const proof = readEvidence(changeDir, input.evidence);
  if (loaded.ledger.attempts.some(attempt => attempt.id === input.id)) {
    throw new Error(`Debug attempt '${input.id}' is already recorded`);
  }
  if (loaded.ledger.attempts.some(attempt => attempt.evidence_sha256 === proof.sha256)) {
    throw new Error('Duplicate evidence cannot count as a distinct debugging attempt');
  }

  const attempt = {
    id: input.id,
    summary: input.summary,
    evidence: proof.path,
    evidence_sha256: proof.sha256,
    recorded_at: new Date().toISOString(),
  };
  loaded.ledger.attempts.push(attempt);
  writeLedger(changeDir, loaded.path, loaded.ledger);
  return { attempt, attempt_count: loaded.ledger.attempts.length, context: loaded.context };
}

export function showDebugAttempts(changeDir) {
  const loaded = loadCurrentLedger(changeDir, { requireDebugging: false });
  return {
    attempts: loaded.ledger.attempts,
    attempt_count: loaded.ledger.attempts.length,
    escalation: loaded.ledger.escalation ?? null,
    context: loaded.context,
  };
}

export function recordDebugEscalation(changeDir, input) {
  if (input?.confirm !== true) {
    throw new Error('DP-5 escalation requires --confirm after the user reviews all failed attempts');
  }
  if (!DECISIONS.has(input?.decision)) {
    throw new Error(`DP-5 decision must be one of: ${[...DECISIONS].join(', ')}`);
  }
  requireSafeText(input?.reason, 'reason');

  const loaded = loadCurrentLedger(changeDir, { requireDebugging: true });
  if (loaded.ledger.attempts.length < MINIMUM_FAILED_ATTEMPTS) {
    throw new Error(`DP-5 escalation requires at least three distinct evidence-backed failed attempts; recorded: ${loaded.ledger.attempts.length}`);
  }

  const recordedAt = new Date().toISOString();
  const result = `${input.decision}: ${input.reason}`;
  const escalation = {
    id: randomUUID(),
    decision: input.decision,
    reason: input.reason,
    result,
    confirmed: true,
    attempt_count: loaded.ledger.attempts.length,
    recorded_at: recordedAt,
  };
  loaded.ledger.escalation = escalation;
  writeLedger(changeDir, loaded.path, loaded.ledger);

  const state = readState(changeDir);
  state.dp_5_result = result;
  state.dp_5_timestamp = recordedAt;
  state.dp_5_decisions = input.reason;
  state.dp_5_confirmed = 'true';
  writeState(changeDir, state);
  return { escalation, attempt_count: loaded.ledger.attempts.length, context: loaded.context };
}

export function inspectDebugEscalation(changeDir, state = readState(changeDir)) {
  if (isEmpty(state.dp_5_result)) return { status: 'not-recorded', supported: false, reason: null };
  if (!isConfirmed(state.dp_5_confirmed)) {
    return unsupported('DP-5 is not supported by explicit confirmation and three evidence-backed failed attempts');
  }
  try {
    const loaded = loadCurrentLedger(changeDir, { requireDebugging: false, state });
    if (loaded.ledger.attempts.length < MINIMUM_FAILED_ATTEMPTS) {
      return unsupported(`DP-5 requires at least three evidence-backed failed attempts; recorded: ${loaded.ledger.attempts.length}`);
    }
    const escalation = loaded.ledger.escalation;
    if (!escalation?.confirmed || escalation.attempt_count !== loaded.ledger.attempts.length) {
      return unsupported('DP-5 ledger does not contain a matching confirmed escalation');
    }
    if (escalation.result !== state.dp_5_result || escalation.recorded_at !== state.dp_5_timestamp) {
      return unsupported('DP-5 state summary does not match its evidence ledger');
    }
    return {
      status: 'supported',
      supported: true,
      reason: null,
      attempt_count: loaded.ledger.attempts.length,
      escalation,
    };
  } catch (error) {
    return unsupported(error.message);
  }
}

function loadCurrentLedger(changeDir, options) {
  const state = options.state ?? readState(changeDir);
  const { context, plan } = buildContext(changeDir, state, options.requireDebugging);
  const path = ledgerPath(changeDir, plan);
  const physicalPath = resolveLedgerPath(changeDir, path);
  if (!existsSync(physicalPath)) {
    return { state, context, path, ledger: { version: LEDGER_VERSION, context, attempts: [] } };
  }
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(physicalPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read debugging attempt ledger: ${error.message}`);
  }
  validateLedger(changeDir, ledger);
  if (!sameContext(ledger.context, context)) {
    throw new Error('Debugging attempt context is stale; record new attempts for the current execution context');
  }
  return { state, context, path, ledger };
}

function buildContext(changeDir, state, requireDebugging) {
  if (requireDebugging && state.state !== 'debugging') {
    throw new Error('Debug attempts and DP-5 escalation require the debugging state');
  }

  const plan = readPlan(changeDir);
  const hasPlanSummary = !isEmpty(state.execution_plan_hash)
    || !isEmpty(state.execution_plan_revision);
  if (hasPlanSummary || plan) {
    if (!plan) throw new Error('Current execution plan is missing for the recorded state summary');
    const validation = validatePlan(changeDir, plan);
    if (!validation.valid) {
      throw new Error(`Current execution plan is stale: ${validation.failures.join('; ')}`);
    }
  }

  return {
    context: {
      workflow: state.workflow ?? 'auto',
      artifacts_hash: computeArtifactsHash(changeDir),
      contract_hash: computeContractHash(changeDir),
      execution_plan_hash: plan?.hash ?? null,
      execution_plan_revision: plan?.revision ?? null,
    },
    plan,
  };
}

function ledgerPath(changeDir, plan) {
  if (plan) return join(getPlanScopedPaths(changeDir, plan).planRoot, 'debug-attempts.json');
  return join(getOverlayPaths(changeDir).root, 'debug-attempts.json');
}

function readEvidence(changeDir, evidence) {
  const changeRoot = realpathSync(resolve(changeDir));
  const unresolved = resolve(isAbsolute(evidence) ? evidence : join(changeRoot, evidence));
  if (!existsSync(unresolved)) throw new Error(`Debug evidence does not exist: ${evidence}`);
  const metadata = lstatSync(unresolved);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Debug evidence must be a physical regular file');
  }
  const physical = realpathSync(unresolved);
  const relativePath = relative(changeRoot, physical);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('Debug evidence must be stored inside the change directory');
  }
  const content = readFileSync(physical);
  return {
    path: relativePath.split(sep).join('/'),
    sha256: `sha256:${createHash('sha256').update(content).digest('hex')}`,
  };
}

function validateLedger(changeDir, ledger) {
  if (ledger?.version !== LEDGER_VERSION || !ledger.context || !Array.isArray(ledger.attempts)) {
    throw new Error('Debugging attempt ledger has an unsupported structure');
  }
  const ids = new Set();
  const evidence = new Set();
  for (const attempt of ledger.attempts) {
    requireSafeText(attempt?.id, 'attempt id');
    requireSafeText(attempt?.summary, 'attempt summary');
    requireSafeText(attempt?.evidence, 'attempt evidence');
    if (!/^sha256:[a-f0-9]{64}$/i.test(attempt?.evidence_sha256 ?? '')) {
      throw new Error('Debugging attempt ledger contains an invalid evidence digest');
    }
    if (ids.has(attempt.id) || evidence.has(attempt.evidence_sha256)) {
      throw new Error('Debugging attempt ledger contains duplicate attempts or evidence');
    }
    const proof = readEvidence(changeDir, attempt.evidence);
    if (proof.sha256 !== attempt.evidence_sha256) {
      throw new Error(`Debug evidence for attempt '${attempt.id}' has changed since it was recorded`);
    }
    ids.add(attempt.id);
    evidence.add(attempt.evidence_sha256);
  }
}

function writeLedger(changeDir, path, ledger) {
  const physicalPath = resolveLedgerPath(changeDir, path, { createParents: true });
  const tempPath = `${physicalPath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tempPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  renameSync(tempPath, physicalPath);
}

function resolveLedgerPath(changeDir, path, options = {}) {
  const lexicalRoot = resolve(changeDir);
  const relativePath = relative(lexicalRoot, resolve(path));
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('Debugging attempt ledger must be stored inside the change directory');
  }

  const physicalRoot = realpathSync(lexicalRoot);
  const segments = relativePath.split(sep);
  const fileName = segments.pop();
  let current = physicalRoot;
  for (const segment of segments) {
    current = join(current, segment);
    if (existsSync(current)) {
      const metadata = lstatSync(current);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error('Debugging attempt ledger parent must be a physical directory');
      }
    } else if (options.createParents) {
      mkdirSync(current);
    }
  }

  const physicalPath = join(current, fileName);
  if (existsSync(physicalPath)) {
    const metadata = lstatSync(physicalPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error('Debugging attempt ledger must be a physical regular file');
    }
  }
  return physicalPath;
}

function sameContext(left, right) {
  return left?.workflow === right.workflow
    && left?.artifacts_hash === right.artifacts_hash
    && left?.contract_hash === right.contract_hash
    && left?.execution_plan_hash === right.execution_plan_hash
    && left?.execution_plan_revision === right.execution_plan_revision;
}

function requireSafeText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) {
    throw new Error(`${field} must not contain control characters or line separators`);
  }
}

function isEmpty(value) {
  return value === null || value === undefined || value === '';
}

function isConfirmed(value) {
  return value === true || value === 'true';
}

function unsupported(reason) {
  return { status: 'unsupported', supported: false, reason };
}

export { MINIMUM_FAILED_ATTEMPTS };
