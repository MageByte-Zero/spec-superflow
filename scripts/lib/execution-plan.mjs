import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, basename, join, relative, resolve, sep } from 'node:path';
import { computeArtifactsHash, computeContractHash } from './hash.mjs';
import { hashReceipt } from './execution-recommendation.mjs';
import { getOverlayPaths, getPlanScopedPaths } from './sdd-overlay.mjs';
import { readState } from './state-loader.mjs';

export const EXECUTION_MODES = ['inline', 'batch-inline', 'sdd'];

const WAVE_STRATEGIES = new Set(['parallel', 'serial']);
const REVIEW_STATUSES = new Set(['pass', 'fail']);
// Protected branches that review receipts must never certify directly. A head
// commit contained only by these branches means the work was committed straight
// onto the trunk instead of through an isolate-created branch.
const PROTECTED_BRANCHES = new Set(['main', 'master']);
const MAX_REPAIR_FAILURES = 3;
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;
const defaultGitRangeValidator = createGitRangeValidator();

export function createPlan(changeDir, input) {
  const state = readState(changeDir);
  const plan = {
    mode: input?.mode,
    source: input?.source,
    rationale: input?.rationale,
    waves: input?.waves,
    artifacts_hash: computeArtifactsHash(changeDir),
    contract_hash: computeContractHash(changeDir),
    workflow: state.workflow,
    revision: input?.revision ?? state.revision ?? 1,
  };
  if (input?.recommendation !== undefined) plan.recommendation = input.recommendation;
  if (input?.recommendationReceipt !== undefined) plan.recommendation_receipt = input.recommendationReceipt;
  if (input?.selection !== undefined) plan.selection = input.selection;
  const failures = validateStructure(plan);
  if (failures.length > 0) throw new Error(`Invalid execution plan: ${failures.join('; ')}`);
  plan.hash = hashPlan(plan);
  return plan;
}

export function readPlan(changeDir) {
  const filePath = getOverlayPaths(changeDir).executionPlan;
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read execution plan: ${error.message}`);
  }
}

export function writePlan(changeDir, plan) {
  const failures = validateStructure(plan);
  const expectedHash = tryHashPlan(plan);
  if (expectedHash === null) failures.push('execution plan content cannot be hashed');
  else if (plan?.hash !== expectedHash) failures.push('execution plan content hash mismatch');
  if (failures.length > 0) throw new Error(`Invalid execution plan: ${failures.join('; ')}`);

  const paths = getOverlayPaths(changeDir);
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(paths.reviews, { recursive: true });
  atomicWrite(paths.executionPlan, `${JSON.stringify(plan, null, 2)}\n`);
  writeExecutionPlanSummary(changeDir, plan);
  return readPlan(changeDir);
}

export function validatePlan(changeDir, plan) {
  const failures = validateStructure(plan);
  const actualHash = tryHashPlan(plan);
  if (actualHash === null) failures.push('execution plan content cannot be hashed');
  else if (plan?.hash !== actualHash) failures.push('execution plan content hash mismatch');

  const state = readState(changeDir);
  if (state.execution_plan_hash !== plan?.hash) {
    failures.push('execution plan summary does not match state');
  }
  if (state.execution_mode !== plan?.mode) {
    failures.push('execution plan mode does not match state');
  }
  if (plan?.artifacts_hash !== computeArtifactsHash(changeDir)) {
    failures.push('execution plan is stale: artifacts hash mismatch');
  }
  if (plan?.contract_hash !== computeContractHash(changeDir)) {
    failures.push('execution plan is stale: contract hash mismatch');
  }
  if (plan?.workflow !== state.workflow) {
    failures.push('execution plan workflow does not match state');
  }
  if (state.execution_plan_revision !== plan?.revision) {
    failures.push('execution plan revision does not match state');
  }
  if (state.revision != null && plan?.revision !== state.revision) {
    failures.push('execution plan revision does not match state');
  }
  if (plan?.workflow !== 'tweak') {
    if (plan?.recommendation === undefined) failures.push('execution plan recommendation is required for full/hotfix');
    if (plan?.recommendation_receipt === undefined) failures.push('execution plan recommendation receipt is required for full/hotfix');
    if (plan?.selection === undefined) failures.push('execution plan selection is required for full/hotfix');
  }
  if (plan?.recommendation_receipt !== undefined) {
    if (plan.recommendation_receipt.artifacts_hash !== plan.artifacts_hash) failures.push('execution plan recommendation receipt artifacts hash does not match plan');
    if (plan.recommendation_receipt.contract_hash !== plan.contract_hash) failures.push('execution plan recommendation receipt contract hash does not match plan');
    if (plan.recommendation_receipt.workflow !== plan.workflow) failures.push('execution plan recommendation receipt workflow does not match plan');
    if (stableJson(plan.recommendation_receipt.waves) !== stableJson(plan.waves)) failures.push('execution plan recommendation receipt waves do not match plan');
    if (stableJson(plan.recommendation_receipt.recommendation) !== stableJson(plan.recommendation)) failures.push('execution plan recommendation receipt does not match plan recommendation');
    const expectedRecommendationPlanRevision = plan.source === 'user-confirmed-revision'
      ? plan.revision - 1
      : null;
    if (plan.recommendation_receipt.execution_plan_revision_at_recommendation !== expectedRecommendationPlanRevision) {
      failures.push('execution plan recommendation receipt does not match the immediately prior plan revision');
    }
  }
  if (plan?.selection !== undefined && plan?.recommendation?.recommendation?.mode) {
    const followedRecommendation = plan.mode === plan.recommendation.recommendation.mode;
    if (plan.selection.followed_recommendation !== followedRecommendation) failures.push('execution plan selection does not match recommended mode');
    if (plan.selection.acknowledged_non_recommendation !== !followedRecommendation) failures.push('execution plan selection acknowledgement does not match recommended mode');
  }
  return { valid: failures.length === 0, failures, plan };
}

export function recordReview(changeDir, waveId, receipt, options = {}) {
  const plan = readPlan(changeDir);
  const validation = validatePlan(changeDir, plan);
  if (!validation.valid) throw new Error(`Cannot record a review for an invalid execution plan: ${validation.failures.join('; ')}`);
  const wave = Array.isArray(plan?.waves) && plan.waves.find(candidate => candidate?.id === waveId);
  if (!wave) throw new Error(`Review receipt references unknown wave '${waveId}'`);
  const blockedBy = blockedDependencies(changeDir, plan, wave);
  if (blockedBy.length > 0) {
    throw new Error(`Wave '${waveId}' cannot be reviewed before dependencies have passing receipts: ${blockedBy.join(', ')}`);
  }
  if (!REVIEW_STATUSES.has(receipt?.status)) {
    throw new Error("Review receipt status must be 'pass' or 'fail'");
  }
  for (const field of ['base', 'head']) requireText(receipt?.[field], `receipt.${field}`);
  const paths = getOverlayPaths(changeDir);
  const planPaths = getPlanScopedPaths(changeDir, plan);
  mkdirSync(paths.reviews, { recursive: true });
  mkdirSync(planPaths.reviews, { recursive: true });
  const reportEvidence = validateReviewReportEvidence(changeDir, receipt?.report);
  const { base, head } = validateReviewRange(changeDir, receipt.base, receipt.head);
  warnIfCwdOutsideIsolation(changeDir);
  assertReviewHeadBranch(changeDir, head, options.runGit);
  const currentReview = readCurrentReviewEvidence(changeDir, waveId, plan);
  if (currentReview.blocker) {
    throw new Error(`Wave '${waveId}' cannot be reviewed while its failed report evidence is invalid: ${currentReview.blocker}`);
  }
  const previousReceipt = currentReview.receipt;
  const previousRepair = readRepairState(
    changeDir,
    plan,
    waveId,
    previousReceipt?.status === 'fail' ? previousReceipt : null,
  );
  let authorization = null;
  if (previousRepair?.status === 'adjudication-required') {
    authorization = readActiveAdjudication(changeDir, plan, waveId, previousRepair, previousReceipt);
    if (!authorization) {
      throw new Error(`Wave '${waveId}' requires adjudication before another review can be recorded`);
    }
  }
  if (previousReceipt?.status === 'pass') {
    throw new Error(`Wave '${waveId}' already has a passing review receipt`);
  }
  validateRepairContinuity(
    previousReceipt,
    previousRepair,
    { status: receipt.status, base, head, report: reportEvidence.path },
    { allowRepeatedRange: authorization === null },
  );

  const savedReceipt = {
    status: receipt.status,
    base,
    head,
    report: reportEvidence.path,
    report_sha256: reportEvidence.sha256,
    plan_hash: plan.hash,
    plan_revision: plan.revision,
    recorded_at: new Date().toISOString(),
  };
  // Keep the established root receipt as a compatibility mirror, while the
  // authoritative current-plan copy preserves history across plan revisions.
  // Both retain the same receipt shape, including report integrity evidence.
  const serializedReceipt = `${JSON.stringify(savedReceipt, null, 2)}\n`;
  atomicWrite(join(paths.reviews, `${safeFileName(waveId)}.json`), serializedReceipt);
  atomicWrite(join(planPaths.reviews, `${safeFileName(waveId)}.json`), serializedReceipt);
  updateRepairState(changeDir, plan, waveId, previousRepair, previousReceipt, savedReceipt);
  if (authorization) consumeAdjudication(changeDir, plan, waveId, authorization.id, savedReceipt);
  if (savedReceipt.status === 'pass') {
    // Task briefs, diff packages, and progress notes are regenerable for this
    // exact plan. Receipt and repair evidence deliberately live beside, not in,
    // this directory and must remain available to closing/repair guards.
    rmSync(getPlanScopedPaths(changeDir, plan).workspace, { recursive: true, force: true });
  }
  return savedReceipt;
}

/**
 * Persists an explicit human decision that authorizes exactly one additional
 * review for the current adjudication-required repair chain.
 */
export function adjudicateWave(changeDir, waveId, input) {
  const plan = readPlan(changeDir);
  const validation = validatePlan(changeDir, plan);
  if (!validation.valid) throw new Error(`Cannot adjudicate an invalid execution plan: ${validation.failures.join('; ')}`);
  const wave = Array.isArray(plan?.waves) && plan.waves.find(candidate => candidate?.id === waveId);
  if (!wave) throw new Error(`Adjudication references unknown wave '${waveId}'`);
  if (input?.decision !== 'allow-review') throw new Error("Adjudication decision must be 'allow-review'");
  if (input?.confirmed !== true) throw new Error('Adjudication requires confirmed human review of the failure chain');
  requireText(input?.reason, 'adjudication.reason');
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(input.reason)) {
    throw new Error('Adjudication reason must not contain control characters or line separators');
  }

  const currentReview = readCurrentReviewEvidence(changeDir, waveId, plan);
  if (currentReview.blocker) {
    throw new Error(`Wave '${waveId}' cannot be adjudicated while its failed report evidence is invalid: ${currentReview.blocker}`);
  }
  const receipt = currentReview.receipt;
  const repair = readRepairState(changeDir, plan, waveId, receipt);
  if (receipt?.status !== 'fail' || repair?.status !== 'adjudication-required') {
    throw new Error(`Wave '${waveId}' is not adjudication-required`);
  }
  if (readActiveAdjudication(changeDir, plan, waveId, repair, receipt)) {
    throw new Error(`Wave '${waveId}' already has an active review authorization`);
  }

  const ledger = readAdjudicationLedger(changeDir, plan, waveId) ?? {
    plan_hash: plan.hash,
    plan_revision: plan.revision,
    wave_id: waveId,
    adjudications: [],
  };
  const authorization = {
    id: randomUUID(),
    status: 'authorized',
    decision: input.decision,
    confirmed: true,
    reason: input.reason.trim(),
    failure_count: repair.failure_count,
    previous_head: repair.previous_head,
    previous_report: repair.previous_report,
    failed_receipt: adjudicationReceiptEvidence(receipt, waveId),
    authorized_at: new Date().toISOString(),
  };
  ledger.adjudications.push(authorization);
  writeAdjudicationLedger(changeDir, plan, waveId, ledger);
  return { ...authorization, active: true };
}

/**
 * Resolves a stale plan (see changes/plan-resync): refreshes the plan's
 * artifacts_hash reference to the current artifacts snapshot, recomputes the
 * plan content hash, refreshes the recommendation overlay seal, migrates both
 * receipt stores' plan_hash fields plus repair-state records, and appends an
 * audit record to the progress ledger. The revision — and with it the
 * plan-scoped directory identity — deliberately stays unchanged.
 *
 * Migration order (review-findings-fix R1/R4): every record first, the plan
 * file last. Each step appends {path, previousContent} to an undo log, so a
 * failure at any point replays the log in reverse and restores the exact
 * pre-resync state: plan untouched means the system is still in its original
 * self-consistent stale state.
 */
export function resyncPlan(changeDir, { reason } = {}) {
  if (!isNonEmptyText(reason)) throw new Error('resync requires a reason describing the non-semantic correction');
  const plan = readPlan(changeDir);
  if (!plan) throw new Error(`No execution plan exists in '${changeDir}'; create one before resyncing`);

  const currentArtifactsHash = computeArtifactsHash(changeDir);
  if (plan.artifacts_hash === currentArtifactsHash) {
    throw new Error('Execution plan is not stale: no need to resync until its artifacts hash differs from the current snapshot');
  }

  const reviewEvidenceByWave = (plan.waves ?? []).map(wave => ({
    wave,
    review: readCurrentReviewEvidence(changeDir, wave.id, plan),
  }));
  const invalidReview = reviewEvidenceByWave.find(({ review }) => review.blocker);
  if (invalidReview) {
    throw new Error(`Cannot resync while wave '${invalidReview.wave.id}' has invalid review evidence: ${invalidReview.review.blocker}`);
  }
  const failedWaves = reviewEvidenceByWave
    .filter(({ review }) => review.receipt?.status === 'fail')
    .map(({ wave }) => wave.id);
  if (failedWaves.length > 0) {
    throw new Error(`Cannot resync while repair chains are open; waves with fail receipts must close their repair loop first: ${failedWaves.join(', ')}`);
  }

  const undoLog = [];
  const writeWithUndo = (targetPath, content) => {
    // 撤销语义要求"写入前必然已读"：旧内容留存于内存，恢复时可用。
    const previousContent = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : null;
    atomicWrite(targetPath, content);
    undoLog.push({ path: targetPath, previousContent });
  };

  try {
    const previousArtifactsHash = plan.artifacts_hash;
    const previousPlan = structuredClone(plan);
    const previousIdentity = getPlanScopedPaths(changeDir, previousPlan);

    // The frozen receipt inside the plan references the artifacts snapshot it
    // certified; resync deliberately refreshes that reference together with
    // the plan itself. The receipt's content hash covers every field including
    // artifacts_hash, so the seal must be recomputed.
    if (isObject(plan.recommendation_receipt)) {
      plan.recommendation_receipt.artifacts_hash = currentArtifactsHash;
      plan.recommendation_receipt.hash = hashReceipt(plan.recommendation_receipt);
    }
    delete plan.hash;
    plan.artifacts_hash = currentArtifactsHash;
    plan.hash = hashPlan(plan);
    // revision 不变，但身份含 hash，因此 plan-scoped 目录搬移到新 identity。
    const migratedIdentity = getPlanScopedPaths(changeDir, plan);

    // 决策 4：overlay 是迁移循环的第一项——更新 artifacts_hash 并重算封印。
    const overlayPath = getOverlayPaths(changeDir).executionRecommendation;
    if (existsSync(overlayPath)) {
      let overlay;
      try {
        overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
      } catch (error) {
        throw new Error(`Unable to read execution recommendation overlay for resync: ${error.message}`);
      }
      if (isObject(overlay)) {
        overlay.artifacts_hash = currentArtifactsHash;
        overlay.hash = hashReceipt(overlay);
        writeWithUndo(overlayPath, `${JSON.stringify(overlay, null, 2)}\n`);
      }
    }

    // 逐项迁移 root reviews + plan-scoped reviews（读旧→改写→写→记撤销），
    // 并在新身份目录补齐目标副本。
    migrateReceiptsPlanHashWithUndo(
      [getOverlayPaths(changeDir).reviews, previousIdentity.reviews],
      new Set([getOverlayPaths(changeDir).reviews, migratedIdentity.reviews]),
      writeWithUndo,
      plan,
      previousPlan.hash,
    );
    // Validate and migrate adjudications while their referenced repair-state
    // chain is still available under the previous plan identity.
    migratePlanScopedEvidenceDirectoryWithUndo(
      previousIdentity.adjudications,
      migratedIdentity.adjudications,
      writeWithUndo,
      undoLog,
      record => migrateAdjudicationLedgerRecord(changeDir, record, previousPlan, plan),
    );
    migratePlanScopedEvidenceDirectoryWithUndo(
      previousIdentity.repairState,
      migratedIdentity.repairState,
      writeWithUndo,
      undoLog,
      record => migrateRepairStateRecord(changeDir, record, previousPlan, plan),
    );

    // Checkpoints, handoffs, and the workspace carry no plan_hash field of
    // their own: readers resolve them purely by the plan-scoped directory
    // identity. Move every remaining record subdirectory onto the resynced
    // identity; moves join the undo log as restore closures.
    migratePlanScopedDirectoryWithUndo(previousIdentity.checkpoints, migratedIdentity.checkpoints, undoLog);
    migratePlanScopedDirectoryWithUndo(previousIdentity.handoffs, migratedIdentity.handoffs, undoLog);
    migratePlanScopedDirectoryWithUndo(previousIdentity.workspace, migratedIdentity.workspace, undoLog);
    removeDirIfEmpty(previousIdentity.planRoot);

    // 决策 2：plan 文件收尾——plan 未动 = 系统仍处原始 stale 态的判据始终成立。
    // C1：plan 与 state summary 两个尾部写入也纳入撤销保护——旧内容读自磁盘
    // （写前必读），后续任何失败都按 undoLog 逆序恢复为 resync 前内容，杜绝
    // "plan 已落新 hash 而 receipts/overlay 恢复旧值"的死锁复发状态。
    writeWithUndo(getOverlayPaths(changeDir).executionPlan, `${JSON.stringify(plan, null, 2)}\n`);
    const summaryPath = join(changeDir, '.spec-superflow.yaml');
    const previousSummaryContent = existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : null;
    writeExecutionPlanSummary(changeDir, plan);
    undoLog.push({ path: summaryPath, previousContent: previousSummaryContent });

    // 取舍声明（review-findings-fix C1）：progress.md 是 append 型审计日志，其
    // 追加失败不回滚已成功的 plan/summary 迁移——审计日志缺少一行不影响 plan 与
    // receipts 的一致性（收尾锚点不变式只依赖前序写入），故仅告警不中断。
    try {
      appendProgressAudit(changeDir, [
        '## Execution Plan Resync',
        `- recorded_at: ${new Date().toISOString()}`,
        `- reason: ${reason}`,
        `- previous_artifacts_hash: ${previousArtifactsHash}`,
        `- artifacts_hash: ${currentArtifactsHash}`,
        `- plan_hash: ${plan.hash}`,
        `- plan_revision: ${plan.revision}`,
      ]);
    } catch (auditError) {
      process.stderr.write(`WARN: resync 完成但 progress.md 审计追加失败（append-only 审计缺一行，不回滚）：${auditError.message}\n`);
    }
    return readPlan(changeDir);
  } catch (error) {
    try {
      restoreUndoLog(undoLog);
    } catch (restoreError) {
      // M2：原始错误在前，恢复失败清单追加在后，不顶替根因。
      error.message = `${error.message}; ${restoreError.message}`;
    }
    throw error;
  }
}

// 按 undoLog 逆序恢复：文件项写回旧内容（或删除新增文件），目录搬移项调用
// restore 闭包。单个恢复动作失败不静默——聚合进清单后抛出复合错误。
function restoreUndoLog(undoLog) {
  const restorationFailures = [];
  for (const entry of [...undoLog].reverse()) {
    try {
      if (typeof entry.restore === 'function') {
        entry.restore();
      } else if (entry.previousContent === null) {
        if (existsSync(entry.path)) rmSync(entry.path, { force: true });
      } else {
        atomicWrite(entry.path, entry.previousContent);
      }
    } catch (undoError) {
      restorationFailures.push(`${entry.path}: ${undoError.message}`);
    }
  }
  if (restorationFailures.length > 0) {
    throw new Error(`resync rollback restoration failures (${restorationFailures.join('; ')})`);
  }
}

// 与旧版 migrateReceiptsPlanHash 相同的收敛逻辑，但每次写入经 writeWithUndo
// 记入撤销日志。文件旧的 JSON 解析失败则跳过（与既有行为一致）。
function migrateReceiptsPlanHashWithUndo(sourceDirectories, targetDirectories, writeWithUndo, plan, previousPlanHash) {
  const targets = new Set(targetDirectories);
  for (const directory of sourceDirectories) {
    if (!existsSync(directory)) continue;
    for (const fileName of readdirSync(directory).filter(name => name.endsWith('.json'))) {
      let record;
      try {
        record = JSON.parse(readFileSync(join(directory, fileName), 'utf8'));
      } catch {
        continue;
      }
      if (!isObject(record) || record.plan_revision !== plan.revision || record.plan_hash !== previousPlanHash) continue;
      record.plan_hash = plan.hash;
      const serialized = `${JSON.stringify(record, null, 2)}\n`;
      writeWithUndo(join(directory, fileName), serialized);
      for (const target of targets) {
        if (target === directory) continue;
        mkdirSync(target, { recursive: true });
        // 新身份下的目标副本同样注册撤销（C2）：迁移中途失败时副本一并回滚，
        // 不残留指向新 plan_hash 的孤儿文件。
        writeWithUndo(join(target, fileName), serialized);
      }
    }
  }
}

function migratePlanScopedEvidenceDirectoryWithUndo(source, target, writeWithUndo, undoLog, migrateRecord) {
  if (!existsSync(source)) return;
  for (const fileName of readdirSync(source).filter(name => name.endsWith('.json'))) {
    const filePath = join(source, fileName);
    let record;
    try {
      record = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (error) {
      throw new Error(`Unable to migrate plan-scoped evidence '${filePath}': ${error.message}`);
    }
    const migrated = migrateRecord(record);
    writeWithUndo(filePath, `${JSON.stringify(migrated, null, 2)}\n`);
  }
  migratePlanScopedDirectoryWithUndo(source, target, undoLog);
}

function migrateRepairStateRecord(changeDir, record, previousPlan, nextPlan) {
  if (!isObject(record) || record.plan_hash !== previousPlan.hash
    || record.plan_revision !== previousPlan.revision || !isNonEmptyText(record.wave_id)) {
    throw new Error('Repair state cannot be resynced because its plan or wave identity is invalid');
  }
  validateRepairStateEvidence(changeDir, previousPlan, record.wave_id, record);
  const migrated = structuredClone(record);
  migrated.plan_hash = nextPlan.hash;
  for (const failure of migrated.failures) failure.plan_hash = nextPlan.hash;
  if (isObject(migrated.resolution)) migrated.resolution.plan_hash = nextPlan.hash;
  return migrated;
}

function migrateAdjudicationLedgerRecord(changeDir, record, previousPlan, nextPlan) {
  if (!isObject(record) || record.plan_hash !== previousPlan.hash
    || record.plan_revision !== previousPlan.revision || !isNonEmptyText(record.wave_id)) {
    throw new Error('Adjudication ledger cannot be resynced because its plan or wave identity is invalid');
  }
  validateAdjudicationLedgerEvidence(changeDir, previousPlan, record.wave_id, record);
  const migrated = structuredClone(record);
  migrated.plan_hash = nextPlan.hash;
  for (const adjudication of migrated.adjudications) {
    adjudication.failed_receipt.plan_hash = nextPlan.hash;
    if (isObject(adjudication.review)) adjudication.review.plan_hash = nextPlan.hash;
  }
  return migrated;
}

// Moves one plan-scoped record directory (checkpoints/handoffs/workspace) onto
// the resynced identity. These records contain no plan_hash fields, so a whole
// directory move preserves them exactly as recorded. Each completed move is
// recorded in the undo log as {path, previousContent: null, restore} so the
// catch-side replay can restore the pre-move layout.
function migratePlanScopedDirectoryWithUndo(source, target, undoLog) {
  if (!existsSync(source)) return;
  if (existsSync(target)) {
    const entries = readdirSync(source, { withFileTypes: true });
    const collision = entries.find(entry => existsSync(join(target, entry.name)));
    if (collision) {
      throw new Error(`Plan-scoped migration target already contains '${collision.name}'; refusing a destructive collision`);
    }
    const movedEntries = [];
    // Register rollback before the first move. If any later rename fails, the
    // catch-side replay can restore every entry that was already moved.
    undoLog.push({
      path: target,
      previousContent: null,
      restore: () => {
        mkdirSync(source, { recursive: true });
        for (const moved of [...movedEntries].reverse()) {
          if (existsSync(moved.from)) renameSync(moved.from, moved.to);
        }
      },
    });
    for (const entry of entries) {
      const destination = join(target, entry.name);
      renameSync(join(source, entry.name), destination);
      movedEntries.push({ from: destination, to: join(source, entry.name) });
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    renameSync(source, target);
    undoLog.push({
      path: target,
      previousContent: null,
      restore: () => {
        mkdirSync(dirname(source), { recursive: true });
        renameSync(target, source);
      },
    });
  }
}

function removeDirIfEmpty(directory) {
  try {
    if (existsSync(directory) && readdirSync(directory).length === 0) rmSync(directory, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only; leftover empty directories are harmless.
  }
}

function appendProgressAudit(changeDir, lines) {
  const progressPath = join(changeDir, '.superpowers', 'sdd', 'progress.md');
  mkdirSync(dirname(progressPath), { recursive: true });
  appendFileSync(progressPath, `${lines.join('\n')}\n`);
}

/**
 * Returns the current plan's receipt for one wave. Receipts from a previous
 * revision/hash are never evidence for the current plan.
 */
export function readCurrentReview(changeDir, waveId, plan = readPlan(changeDir)) {
  return readCurrentReviewEvidence(changeDir, waveId, plan).receipt;
}

function readCurrentReviewEvidence(changeDir, waveId, plan = readPlan(changeDir)) {
  if (!plan) return { receipt: null, blocker: null };
  const currentScope = getPlanScopedPaths(changeDir, plan);
  const currentPath = join(currentScope.reviews, `${safeFileName(waveId)}.json`);
  const legacyPath = join(getOverlayPaths(changeDir).reviews, `${safeFileName(waveId)}.json`);
  // Newer callers may have written a scoped receipt, but the established
  // root receipt remains the compatibility source until a future format
  // migration. In either case the plan identity below is mandatory.
  const filePath = existsSync(currentPath) ? currentPath : legacyPath;
  if (!existsSync(filePath)) return { receipt: null, blocker: null };
  try {
    const receipt = JSON.parse(readFileSync(filePath, 'utf8'));
    if (receipt?.plan_hash !== plan.hash || receipt?.plan_revision !== plan.revision) return { receipt: null, blocker: null };
    const range = validateReviewRange(changeDir, receipt?.base, receipt?.head);
    if (receipt.base !== range.base || receipt.head !== range.head) return { receipt: null, blocker: null };
    // Reports remain evidence only while their safety and content identity can
    // be re-established. A missing hash is accepted for legacy receipts, but
    // all newly written receipts bind the report body to the review result.
    const evidence = validateReviewReportEvidence(changeDir, receipt.report);
    if (receipt.report_sha256 !== undefined && receipt.report_sha256 !== evidence.sha256) {
      throw new Error('review report evidence content no longer matches its receipt');
    }
    return { receipt, blocker: null };
  } catch (error) {
    // A corrupted pass receipt is treated as absent so the wave can be
    // reviewed again. A failed receipt is different: reopening it would erase
    // the repair-chain evidence and permit an unaudited retry.
    try {
      const receipt = JSON.parse(readFileSync(filePath, 'utf8'));
      if (receipt?.plan_hash === plan.hash && receipt?.plan_revision === plan.revision && receipt?.status === 'fail') {
        return { receipt: null, blocker: `failed review report evidence is invalid: ${error.message}` };
      }
    } catch {
      // An unreadable receipt has no trustworthy status to preserve.
    }
    return { receipt: null, blocker: null };
  }
}

/**
 * Machine-readable execution status used by `ssf execution show`. A wave is
 * eligible when it has no current receipt, or its current receipt failed and
 * is therefore retryable, and all declared dependencies have passing receipts.
 */
export function describeWaves(changeDir, plan = readPlan(changeDir)) {
  if (!plan || !Array.isArray(plan.waves)) return [];
  return plan.waves.map(wave => {
    const review = readCurrentReviewEvidence(changeDir, wave.id, plan);
    const receipt = review.receipt;
    const blockers = [
      ...blockedDependencies(changeDir, plan, wave),
      ...(review.blocker ? [review.blocker] : []),
    ];
    let repair;
    try {
      repair = describeRepairState(changeDir, plan, wave.id, receipt);
    } catch (error) {
      blockers.push(`repair state evidence is invalid: ${error.message}`);
      repair = {
        status: 'invalid', failure_count: 0, previous_head: null,
        previous_report: null, failures: [],
      };
    }
    const adjudication = describeAdjudication(changeDir, plan, wave.id, repair, receipt);
    const retryable = blockers.length === 0 && receipt?.status === 'fail'
      && (repair.status !== 'adjudication-required' || adjudication?.active === true);
    return {
      id: wave.id,
      strategy: wave.strategy,
      tasks: wave.tasks,
      depends_on: wave.depends_on,
      eligible: (receipt === null || retryable) && blockers.length === 0,
      retryable,
      receipt,
      blockers,
      repair,
      ...(adjudication ? { adjudication } : {}),
    };
  });
}

function validateRepairContinuity(previousReceipt, previousRepair, nextReceipt, { allowRepeatedRange = true } = {}) {
  if (previousReceipt?.status !== 'fail') return;
  const previousHead = previousRepair?.previous_head ?? previousReceipt.head;
  if (!previousHead) throw new Error('Repair state is missing the previous review head');

  if (!allowRepeatedRange && nextReceipt.base === nextReceipt.head) {
    throw new Error('Authorized repair review must include a non-empty Git range; base and head must differ');
  }

  // A failed re-review must examine a repair that starts at the prior review
  // head. Outside adjudication, a pass may also certify the exact original
  // range to preserve the established fail→pass receipt flow. A human
  // authorization disables that compatibility exception.
  const repeatsPreviousRange = allowRepeatedRange && nextReceipt.status === 'pass'
    && nextReceipt.base === previousReceipt.base
    && nextReceipt.head === previousReceipt.head;
  if (nextReceipt.base !== previousHead && !repeatsPreviousRange) {
    throw new Error('Repair review base must equal the previous review head so repair ranges are continuous');
  }
}

function updateRepairState(changeDir, plan, waveId, previousRepair, previousReceipt, receipt) {
  const paths = getPlanScopedPaths(changeDir, plan);
  mkdirSync(paths.repairState, { recursive: true });
  const statePath = join(paths.repairState, `${safeFileName(waveId)}.json`);
  const now = new Date().toISOString();
  const priorFailures = Array.isArray(previousRepair?.failures) ? previousRepair.failures : [];
  let state;

  if (receipt.status === 'fail') {
    const failures = [...priorFailures, reviewEvidence(receipt, waveId)];
    state = {
      plan_hash: plan.hash,
      plan_revision: plan.revision,
      wave_id: waveId,
      status: failures.length >= MAX_REPAIR_FAILURES ? 'adjudication-required' : 'repairing',
      failure_count: failures.length,
      previous_head: receipt.head,
      previous_report: receipt.report,
      failures,
      updated_at: now,
    };
  } else if (previousReceipt?.status === 'fail' || previousRepair?.failure_count > 0) {
    state = {
      plan_hash: plan.hash,
      plan_revision: plan.revision,
      wave_id: waveId,
      status: 'resolved',
      failure_count: priorFailures.length,
      previous_head: receipt.head,
      previous_report: previousRepair?.previous_report ?? priorFailures.at(-1)?.report ?? null,
      failures: priorFailures,
      resolution: reviewEvidence(receipt, waveId),
      updated_at: now,
    };
  } else {
    // A first-pass receipt does not begin a repair chain. Do not manufacture
    // repair evidence for it, but still leave no stale state for this wave.
    if (existsSync(statePath)) rmSync(statePath, { force: true });
    return null;
  }
  atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

function reviewEvidence(receipt, waveId) {
  return {
    status: receipt.status,
    base: receipt.base,
    head: receipt.head,
    report: receipt.report,
    report_sha256: receipt.report_sha256,
    plan_hash: receipt.plan_hash,
    plan_revision: receipt.plan_revision,
    wave_id: waveId,
    recorded_at: receipt.recorded_at,
  };
}

function adjudicationReceiptEvidence(receipt, waveId) {
  return reviewEvidence(receipt, waveId);
}

function readRepairState(changeDir, plan, waveId, currentReceipt = null) {
  if (!plan) return null;
  const statePath = join(getPlanScopedPaths(changeDir, plan).repairState, `${safeFileName(waveId)}.json`);
  if (!existsSync(statePath)) return null;
  let state;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read repair state: ${error.message}`);
  }
  validateRepairStateEvidence(changeDir, plan, waveId, state, currentReceipt);
  return state;
}

function validateRepairStateEvidence(changeDir, plan, waveId, state, currentReceipt = null) {
  if (state?.plan_hash !== plan.hash || state?.plan_revision !== plan.revision || state?.wave_id !== waveId) {
    throw new Error('Repair state plan or wave identity does not match the current execution plan');
  }
  if (!['repairing', 'resolved', 'adjudication-required'].includes(state.status)) {
    throw new Error('Repair state status is invalid');
  }
  if (!Number.isInteger(state.failure_count) || state.failure_count < 1 || !Array.isArray(state.failures)
    || state.failures.length !== state.failure_count || !isNonEmptyText(state.previous_head)
    || !isNonEmptyText(state.previous_report)) {
    throw new Error('Repair state failure history is malformed');
  }
  if (state.status === 'repairing' && state.failure_count >= MAX_REPAIR_FAILURES) {
    throw new Error('Repair state status does not match its failure count');
  }
  if (state.status === 'adjudication-required' && state.failure_count < MAX_REPAIR_FAILURES) {
    throw new Error('Repair state status does not meet the adjudication threshold');
  }

  let previousFailure = null;
  for (const [index, failure] of state.failures.entries()) {
    const label = `Repair state failure ${index + 1}`;
    if (failure?.status !== 'fail' || failure?.plan_hash !== plan.hash
      || failure?.plan_revision !== plan.revision || failure?.wave_id !== waveId) {
      throw new Error(`${label} plan or wave binding is invalid`);
    }
    if (!isNonEmptyText(failure.base) || !isNonEmptyText(failure.head)
      || !isNonEmptyText(failure.report) || !/^sha256:[0-9a-f]{64}$/i.test(failure.report_sha256 ?? '')
      || !isNonEmptyText(failure.recorded_at) || Number.isNaN(Date.parse(failure.recorded_at))) {
      throw new Error(`${label} evidence is malformed`);
    }
    const range = validateReviewRange(changeDir, failure.base, failure.head);
    if (failure.base !== range.base || failure.head !== range.head) {
      throw new Error(`${label} must use immutable Git commit IDs`);
    }
    if (previousFailure && failure.base !== previousFailure.head) {
      throw new Error(`${label} base must equal the previous failure head so repair ranges are continuous`);
    }
    const report = validateReviewReportEvidence(changeDir, failure.report);
    if (failure.report !== report.path || failure.report_sha256 !== report.sha256) {
      throw new Error(`${label} report content does not match its recorded hash`);
    }
    previousFailure = failure;
  }

  const finalFailure = state.failures.at(-1);
  if (state.status === 'resolved') {
    const resolution = state.resolution;
    if (resolution?.status !== 'pass' || resolution?.plan_hash !== plan.hash
      || resolution?.plan_revision !== plan.revision || resolution?.wave_id !== waveId
      || !isNonEmptyText(resolution.base) || !isNonEmptyText(resolution.head)
      || !isNonEmptyText(resolution.report) || !/^sha256:[0-9a-f]{64}$/i.test(resolution.report_sha256 ?? '')
      || !isNonEmptyText(resolution.recorded_at) || Number.isNaN(Date.parse(resolution.recorded_at))) {
      throw new Error('Repair state resolution evidence is malformed');
    }
    const resolutionRange = validateReviewRange(changeDir, resolution.base, resolution.head);
    if (resolution.base !== resolutionRange.base || resolution.head !== resolutionRange.head) {
      throw new Error('Repair state resolution must use immutable Git commit IDs');
    }
    const resolutionReport = validateReviewReportEvidence(changeDir, resolution.report);
    if (resolution.report !== resolutionReport.path || resolution.report_sha256 !== resolutionReport.sha256) {
      throw new Error('Repair state resolution report content does not match its recorded hash');
    }
    if (state.previous_head !== resolution.head || state.previous_report !== finalFailure.report) {
      throw new Error('Resolved repair state does not match its resolution and final failure evidence');
    }
  } else if (state.previous_head !== finalFailure.head || state.previous_report !== finalFailure.report) {
    throw new Error('Repair state previous evidence does not match its final failure');
  }
  if (currentReceipt && !sameReviewEvidence(finalFailure, currentReceipt, plan, waveId)) {
    throw new Error('Repair state final failure does not match the current failed receipt');
  }
}

function sameReviewEvidence(evidence, receipt, plan, waveId) {
  return evidence?.status === receipt?.status
    && evidence?.base === receipt?.base
    && evidence?.head === receipt?.head
    && evidence?.report === receipt?.report
    && evidence?.report_sha256 === receipt?.report_sha256
    && evidence?.plan_hash === plan.hash
    && evidence?.plan_revision === plan.revision
    && evidence?.wave_id === waveId
    && evidence?.recorded_at === receipt?.recorded_at;
}

function describeRepairState(changeDir, plan, waveId, receipt) {
  const state = readRepairState(
    changeDir,
    plan,
    waveId,
    receipt?.status === 'fail' ? receipt : null,
  );
  if (state) return state;
  if (receipt?.status === 'fail') {
    // A valid legacy fail receipt predates repair-state. It remains retryable
    // for compatibility, but has no fabricated audit history.
    return {
      status: 'repairing', failure_count: 1, previous_head: receipt.head,
      previous_report: receipt.report, failures: [],
    };
  }
  return {
    status: 'not-needed', failure_count: 0, previous_head: null,
    previous_report: null, failures: [],
  };
}

function adjudicationPath(changeDir, plan, waveId) {
  return join(getPlanScopedPaths(changeDir, plan).adjudications, `${safeFileName(waveId)}.json`);
}

function readAdjudicationLedger(changeDir, plan, waveId) {
  if (!plan) return null;
  const filePath = adjudicationPath(changeDir, plan, waveId);
  if (!existsSync(filePath)) return null;
  try {
    const ledger = JSON.parse(readFileSync(filePath, 'utf8'));
    if (ledger?.plan_hash !== plan.hash || ledger?.plan_revision !== plan.revision
      || ledger?.wave_id !== waveId || !Array.isArray(ledger.adjudications)) {
      throw new Error('adjudication ledger identity or entries are invalid');
    }
    validateAdjudicationLedgerEvidence(changeDir, plan, waveId, ledger);
    return ledger;
  } catch (error) {
    throw new Error(`Unable to read adjudication evidence: ${error.message}`);
  }
}

function validateAdjudicationLedgerEvidence(changeDir, plan, waveId, ledger) {
  if (!Array.isArray(ledger?.adjudications) || ledger.adjudications.length === 0) {
    throw new Error('adjudication ledger must contain at least one audit entry');
  }
  const repair = readRepairState(changeDir, plan, waveId);
  if (!repair || !Array.isArray(repair.failures) || repair.failures.length === 0) {
    throw new Error('adjudication ledger has no repair chain to bind its entries');
  }
  const ids = new Set();
  let previousFailureCount = 0;
  for (const [index, entry] of ledger.adjudications.entries()) {
    const label = `Adjudication entry ${index + 1}`;
    if (!isNonEmptyText(entry?.id) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.id)) {
      throw new Error(`${label} id is invalid`);
    }
    if (ids.has(entry.id)) throw new Error(`${label} id is duplicated`);
    ids.add(entry.id);
    if (!['authorized', 'consumed'].includes(entry.status) || entry.decision !== 'allow-review'
      || entry.confirmed !== true || !isNonEmptyText(entry.reason)
      || entry.reason !== entry.reason.trim() || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(entry.reason)
      || !isValidTimestamp(entry.authorized_at)
      || !Number.isInteger(entry.failure_count) || entry.failure_count < MAX_REPAIR_FAILURES
      || !isNonEmptyText(entry.previous_head) || !isNonEmptyText(entry.previous_report)) {
      throw new Error(`${label} audit evidence is malformed`);
    }
    if (entry.failure_count <= previousFailureCount) {
      throw new Error(`${label} failure count must advance through the repair chain`);
    }
    previousFailureCount = entry.failure_count;
    validateStoredReviewEvidence(changeDir, plan, waveId, entry.failed_receipt, {
      expectedStatuses: new Set(['fail']),
      label: `${label} failed receipt`,
    });
    if (entry.previous_head !== entry.failed_receipt.head
      || entry.previous_report !== entry.failed_receipt.report) {
      throw new Error(`${label} repair identity does not match its failed receipt`);
    }
    const adjudicatedFailure = repair.failures[entry.failure_count - 1];
    if (!adjudicatedFailure) {
      throw new Error(`${label} failure count does not identify an existing repair chain failure`);
    }
    if (!sameReviewEvidence(entry.failed_receipt, adjudicatedFailure, plan, waveId)) {
      throw new Error(`${label} failed receipt does not match the identified repair chain failure`);
    }
    if (entry.status === 'authorized') {
      if (entry.consumed_at !== undefined || entry.review !== undefined) {
        throw new Error(`${label} authorized evidence must not contain consumed review fields`);
      }
      if (index !== ledger.adjudications.length - 1) {
        throw new Error(`${label} authorized evidence must be the latest ledger entry`);
      }
      continue;
    }
    if (!isValidTimestamp(entry.consumed_at) || Date.parse(entry.consumed_at) < Date.parse(entry.authorized_at)) {
      throw new Error(`${label} consumption timestamp is invalid`);
    }
    validateStoredReviewEvidence(changeDir, plan, waveId, entry.review, {
      expectedStatuses: REVIEW_STATUSES,
      label: `${label} consumed review`,
    });
    if (entry.review.base !== entry.previous_head || entry.review.base === entry.review.head) {
      throw new Error(`${label} consumed review must be a non-empty range continuous from the adjudicated head`);
    }
    const expectedReview = entry.review.status === 'fail'
      ? repair.failures[entry.failure_count]
      : repair.resolution;
    if (!expectedReview || !sameReviewEvidence(entry.review, expectedReview, plan, waveId)) {
      throw new Error(`${label} consumed review does not match the next repair chain outcome`);
    }
  }
}

function validateStoredReviewEvidence(changeDir, plan, waveId, evidence, { expectedStatuses, label }) {
  if (!isObject(evidence) || !expectedStatuses.has(evidence.status)
    || evidence.plan_hash !== plan.hash || evidence.plan_revision !== plan.revision
    || evidence.wave_id !== waveId || !isNonEmptyText(evidence.base) || !isNonEmptyText(evidence.head)
    || !isNonEmptyText(evidence.report) || !/^sha256:[0-9a-f]{64}$/i.test(evidence.report_sha256 ?? '')
    || !isValidTimestamp(evidence.recorded_at)) {
    throw new Error(`${label} audit evidence is malformed`);
  }
  const range = validateReviewRange(changeDir, evidence.base, evidence.head);
  if (evidence.base !== range.base || evidence.head !== range.head) {
    throw new Error(`${label} must use immutable Git commit IDs`);
  }
  const report = validateReviewReportEvidence(changeDir, evidence.report);
  if (evidence.report !== report.path || evidence.report_sha256 !== report.sha256) {
    throw new Error(`${label} report content does not match its recorded hash`);
  }
}

function isValidTimestamp(value) {
  return isNonEmptyText(value) && !Number.isNaN(Date.parse(value));
}

function writeAdjudicationLedger(changeDir, plan, waveId, ledger) {
  const directory = getPlanScopedPaths(changeDir, plan).adjudications;
  mkdirSync(directory, { recursive: true });
  atomicWrite(adjudicationPath(changeDir, plan, waveId), `${JSON.stringify(ledger, null, 2)}\n`);
}

function readActiveAdjudication(changeDir, plan, waveId, repair, receipt) {
  const latest = readAdjudicationLedger(changeDir, plan, waveId)?.adjudications.at(-1);
  if (!latest || latest.status !== 'authorized' || latest.decision !== 'allow-review' || latest.confirmed !== true) return null;
  if (repair?.status !== 'adjudication-required' || receipt?.status !== 'fail') return null;
  validateRepairStateEvidence(changeDir, plan, waveId, repair, receipt);
  if (latest.failure_count !== repair.failure_count
    || latest.previous_head !== repair.previous_head
    || latest.previous_report !== repair.previous_report
    || !sameReviewEvidence(latest.failed_receipt, receipt, plan, waveId)) return null;
  return latest;
}

function describeAdjudication(changeDir, plan, waveId, repair, receipt) {
  const latest = readAdjudicationLedger(changeDir, plan, waveId)?.adjudications.at(-1);
  if (!latest) return null;
  return { ...latest, active: readActiveAdjudication(changeDir, plan, waveId, repair, receipt)?.id === latest.id };
}

function consumeAdjudication(changeDir, plan, waveId, authorizationId, receipt) {
  const ledger = readAdjudicationLedger(changeDir, plan, waveId);
  const authorization = ledger?.adjudications.find(candidate => candidate.id === authorizationId);
  if (!authorization || authorization.status !== 'authorized') return;
  authorization.status = 'consumed';
  authorization.consumed_at = new Date().toISOString();
  authorization.review = reviewEvidence(receipt, waveId);
  writeAdjudicationLedger(changeDir, plan, waveId, ledger);
}

function validateReviewReportEvidence(changeDir, report) {
  requireText(report, 'receipt.report');
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(report)) {
    throw new Error('Review report evidence path is unsafe');
  }

  const { changeRoot, reviewsDir } = getPhysicalReviewsDirectory(changeDir);
  const reportPath = isAbsolute(report) ? resolve(report) : resolve(changeRoot, report);

  let metadata;
  try {
    metadata = lstatSync(reportPath);
  } catch (error) {
    throw new Error(`Review report evidence cannot be read: ${error.message}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('Review report evidence must be a regular file');
  }
  if (metadata.size === 0) {
    throw new Error('Review report evidence must be non-empty');
  }
  const realReportPath = realpathSync(reportPath);
  const realOverlayRelativePath = relative(reviewsDir, realReportPath);
  if (realOverlayRelativePath === '' || realOverlayRelativePath === '..' || realOverlayRelativePath.startsWith(`..${sep}`) || isAbsolute(realOverlayRelativePath)) {
    throw new Error('Review report evidence must resolve inside the change review overlay');
  }
  return {
    path: relative(changeRoot, realReportPath),
    sha256: `sha256:${createHash('sha256').update(readFileSync(realReportPath)).digest('hex')}`,
  };
}

function getPhysicalReviewsDirectory(changeDir) {
  let changeRoot;
  try {
    changeRoot = realpathSync(changeDir);
  } catch (error) {
    throw new Error(`Review report evidence cannot resolve the change directory: ${error.message}`);
  }

  let directory = changeRoot;
  for (const component of ['.superpowers', 'sdd', 'reviews']) {
    directory = join(directory, component);
    let metadata;
    try {
      metadata = lstatSync(directory);
    } catch (error) {
      throw new Error(`Review report evidence cannot read the ${component} overlay directory: ${error.message}`);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('Review report evidence requires physical .superpowers/sdd/reviews overlay directories');
    }
  }
  return { changeRoot, reviewsDir: directory };
}

function validateReviewRange(changeDir, base, head) {
  return defaultGitRangeValidator.validate(changeDir, base, head);
}

/**
 * Builds the internal Git proof boundary used by execution-plan validation.
 * The cache is intentionally process-local and only trusts complete immutable
 * commit IDs. Mutable revision inputs must be resolved on every call.
 */
export function createGitRangeValidator(runGit = defaultRunGit) {
  const rootsByChangeDir = new Map();
  const commitsByRepository = new Map();
  const verifiedRanges = new Map();

  function getGitRoot(changeDir, cacheable) {
    const changeKey = resolve(changeDir);
    if (cacheable && rootsByChangeDir.has(changeKey)) return rootsByChangeDir.get(changeKey);
    let gitRoot;
    try {
      gitRoot = runGit(['-C', changeDir, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      throw new Error('Review receipts require the change directory to be inside a Git work tree');
    }
    if (cacheable) rootsByChangeDir.set(changeKey, gitRoot);
    return gitRoot;
  }

  function resolveCommit(gitRoot, revision, field, cacheable) {
    const cacheKey = `${gitRoot}\u0000${revision}`;
    if (cacheable && commitsByRepository.has(cacheKey)) return commitsByRepository.get(cacheKey);
    let resolved;
    try {
      resolved = runGit(['-C', gitRoot, 'rev-parse', '--verify', `${revision}^{commit}`], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      throw new Error(`Review receipt ${field} must name an existing Git commit`);
    }
    if (cacheable) commitsByRepository.set(cacheKey, resolved);
    return resolved;
  }

  return {
    validate(changeDir, base, head) {
      const cacheable = FULL_COMMIT_SHA.test(base) && FULL_COMMIT_SHA.test(head);
      const gitRoot = getGitRoot(changeDir, cacheable);
      const resolvedBase = resolveCommit(gitRoot, base, 'base', cacheable);
      const resolvedHead = resolveCommit(gitRoot, head, 'head', cacheable);
      const rangeKey = `${gitRoot}\u0000${resolvedBase}\u0000${resolvedHead}`;
      if (cacheable && verifiedRanges.has(rangeKey)) {
        const cached = verifiedRanges.get(rangeKey);
        if (cached === null) throw new Error('Review receipt base must be an ancestor of head');
        return cached;
      }
      try {
        runGit(['-C', gitRoot, 'merge-base', '--is-ancestor', resolvedBase, resolvedHead], { stdio: 'ignore' });
      } catch {
        if (cacheable) verifiedRanges.set(rangeKey, null);
        throw new Error('Review receipt base must be an ancestor of head');
      }
      const result = { base: resolvedBase, head: resolvedHead };
      if (cacheable) verifiedRanges.set(rangeKey, result);
      return result;
    },
  };
}

function defaultRunGit(args, options) {
  return execFileSync('git', args, options);
}

/**
 * R4: head 只被 protected 分支（main/master）包含时，拒绝 review receipt。
 * 验证使用 `git branch --contains`：结果含任一非 protected 分支（含隔离分支
 * 已 merge 回主干、head 同时被 main 与隔离分支包含的场景）即放行。此步骤在
 * 写 receipt 之前执行，拒绝时不写入任何 receipt 文件。git root 解析失败时
 * 抛出明确错误（review-findings-fix R4）：静默 return 等于绕过安全校验。
 */
function assertReviewHeadBranch(changeDir, head, runGit = defaultRunGit) {
  let gitRoot;
  try {
    gitRoot = runGit(['-C', changeDir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    throw new Error(`Review head branch verification cannot resolve the git root for '${changeDir}': ${error.message}`);
  }
  let output;
  try {
    output = runGit(['-C', gitRoot, 'branch', '--contains', head, '--format=%(refname:short)'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    throw new Error(`Review head branch verification failed for commit ${head}: ${error.message}`);
  }
  const branches = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (branches.length === 0) return;
  if (branches.every(branch => PROTECTED_BRANCHES.has(branch))) {
    throw new Error(`Review head commit ${head} is only contained by protected branch(es): ${branches.join(', ')}; review requires a commit on a non-protected isolated branch`);
  }
}

/**
 * R5: change 存在隔离 worktree 且进程 cwd 不在该 worktree 内时，输出一行含
 * worktree 绝对路径的 WARN（不阻断命令）。change 无隔离 worktree 时不输出。
 * 隔离 worktree 按 change 目录名命名（isolate 创建的分支名 = change-name）。
 * git root / worktree 列表解析失败时（review-findings-fix R5）输出解析失败
 * 原因的 WARN，而非静默返回。
 */
function warnIfCwdOutsideIsolation(changeDir) {
  const name = basename(resolve(changeDir));
  let gitRoot;
  try {
    gitRoot = execFileSync('git', ['-C', changeDir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    process.stderr.write(`WARN: 无法确认进程 cwd 是否在隔离 worktree 内——git root 解析失败：${error.message}\n`);
    return;
  }
  let entries;
  try {
    entries = parseWorktreeEntries(execFileSync('git', ['-C', gitRoot, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim());
  } catch (error) {
    process.stderr.write(`WARN: 无法确认进程 cwd 是否在隔离 worktree 内——git worktree list 失败：${error.message}\n`);
    return;
  }
  const entry = entries.find(item => item.branch === `refs/heads/${name}`);
  if (!entry) return;
  if (isSubpath(entry.path, process.cwd())) return;
  process.stdout.write(
    `WARN: 进程 cwd（${process.cwd()}）不在隔离 worktree 内。worktree 绝对路径：${entry.path}；` +
    '实现编辑必须使用 worktree 内路径，或每条命令以前缀 `cd <worktree> &&` 开头。\n'
  );
}

// 解析 `git worktree list --porcelain`：返回 [{ path, branch }]。
function parseWorktreeEntries(output) {
  const entries = [];
  for (const block of output.split(/\n[ \t]*\n/)) {
    const lines = block.split('\n').map(line => line.trim());
    if (!lines[0]) continue;
    const entry = { path: null, branch: null };
    for (const line of lines) {
      if (line.startsWith('worktree ')) entry.path = resolve(line.slice('worktree '.length));
      else if (line.startsWith('branch ')) entry.branch = line.slice('branch '.length);
    }
    if (entry.path) entries.push(entry);
  }
  return entries;
}

// 规范化路径：realpath 解析 8.3 短名/junction，失败时退化为 resolve。
// 必须用 native 版本：JS 版 realpathSync 无法解析 8.3 短名组件，CI
// Windows runner 的 TEMP 是 C:\Users\RUNNER~1\... 短名形式，与 git
// worktree list 输出的长路径比较会误报 R5 越界 WARN。
function normalizedPath(p) {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
}

// child 是否位于 parent 内（大小写不敏感，兼容 Windows 盘符）。
// 导出供测试验证 8.3 短路径兼容性（path-normalization.test.mjs）。
export function isSubpath(parent, child) {
  const p = normalizedPath(parent).toLowerCase();
  const c = normalizedPath(child).toLowerCase();
  return c === p || c.startsWith(`${p}${sep}`);
}

function blockedDependencies(changeDir, plan, wave) {
  if (!Array.isArray(wave?.depends_on)) return [];
  return wave.depends_on.filter(dependency => readCurrentReview(changeDir, dependency, plan)?.status !== 'pass');
}

function validateStructure(plan) {
  const failures = [];
  if (!isObject(plan)) return ['execution plan must be an object'];
  if (!EXECUTION_MODES.includes(plan.mode)) failures.push('execution plan mode is invalid');
  if (typeof plan.source !== 'string' || !plan.source.trim()) failures.push('execution plan source is required');
  if (!isNonEmptyText(plan.rationale)) failures.push('execution plan rationale is required');
  if (plan.recommendation !== undefined) {
    if (!isObject(plan.recommendation)) {
      failures.push('execution plan recommendation must be an object');
    } else {
      if (!isObject(plan.recommendation.recommendation) || !EXECUTION_MODES.includes(plan.recommendation.recommendation.mode)) {
        failures.push('execution plan recommendation mode is invalid');
      }
      if (!Array.isArray(plan.recommendation.recommendation?.reasons) || plan.recommendation.recommendation.reasons.some(reason => !isNonEmptyText(reason))) {
        failures.push('execution plan recommendation reasons must be non-empty strings');
      }
      if (!isObject(plan.recommendation.facts)) failures.push('execution plan recommendation facts must be an object');
      if (!Array.isArray(plan.recommendation.available_modes) || plan.recommendation.available_modes.some(mode => !EXECUTION_MODES.includes(mode))) {
        failures.push('execution plan recommendation available_modes are invalid');
      }
    }
  }
  if (plan.recommendation_receipt !== undefined) {
    if (!isObject(plan.recommendation_receipt)) {
      failures.push('execution plan recommendation receipt must be an object');
    } else {
      if (!isObject(plan.recommendation_receipt.recommendation)) failures.push('execution plan recommendation receipt payload is required');
      if (!Array.isArray(plan.recommendation_receipt.waves)) failures.push('execution plan recommendation receipt waves must be an array');
      if (!isNullableHash(plan.recommendation_receipt.artifacts_hash)) failures.push('execution plan recommendation receipt artifacts hash is invalid');
      if (!isNullableHash(plan.recommendation_receipt.contract_hash)) failures.push('execution plan recommendation receipt contract hash is invalid');
      if (!isNonEmptyText(plan.recommendation_receipt.workflow)) failures.push('execution plan recommendation receipt workflow is invalid');
      if (plan.recommendation_receipt.execution_plan_revision_at_recommendation !== null
        && (!Number.isInteger(plan.recommendation_receipt.execution_plan_revision_at_recommendation)
          || plan.recommendation_receipt.execution_plan_revision_at_recommendation < 1)) {
        failures.push('execution plan recommendation receipt plan revision is invalid');
      }
      if (!isNonEmptyText(plan.recommendation_receipt.created_at)) failures.push('execution plan recommendation receipt timestamp is invalid');
      if (typeof plan.recommendation_receipt.hash !== 'string' || !plan.recommendation_receipt.hash.startsWith('sha256:')) failures.push('execution plan recommendation receipt hash is invalid');
    }
  }
  if (plan.selection !== undefined) {
    if (!isObject(plan.selection)) {
      failures.push('execution plan selection must be an object');
    } else {
      if (plan.selection.confirmed !== true) failures.push('execution plan selection must be confirmed');
      if (typeof plan.selection.followed_recommendation !== 'boolean') failures.push('execution plan selection must record recommendation alignment');
      if (typeof plan.selection.acknowledged_non_recommendation !== 'boolean') failures.push('execution plan selection must record non-recommendation acknowledgement');
      if (plan.selection.followed_recommendation === plan.selection.acknowledged_non_recommendation) {
        failures.push('execution plan selection acknowledgement conflicts with recommendation alignment');
      }
    }
  }
  if (!Array.isArray(plan.waves)) {
    failures.push('execution plan waves must be an array');
    return failures;
  }

  const ids = new Set();
  const taskOwners = new Map();
  for (const [index, wave] of plan.waves.entries()) {
    const label = `wave ${index + 1}`;
    if (!isObject(wave)) {
      failures.push(`${label} must be an object`);
      continue;
    }
    if (!isNonEmptyText(wave.id)) failures.push(`${label} id is required`);
    else if (ids.has(wave.id)) failures.push(`duplicate wave id '${wave.id}'`);
    else ids.add(wave.id);
    if (!WAVE_STRATEGIES.has(wave.strategy)) failures.push(`${label} strategy is invalid`);
    if (!Array.isArray(wave.tasks) || wave.tasks.length === 0) {
      failures.push(`${label} must include at least one task`);
    } else {
      if (wave.tasks.some(task => !isNonEmptyText(task))) failures.push(`${label} tasks must be non-empty strings`);
      for (const task of wave.tasks.filter(isNonEmptyText)) {
        const priorWaveId = taskOwners.get(task);
        if (priorWaveId !== undefined) {
          failures.push(`duplicate task id '${task}' appears in waves '${priorWaveId}' and '${wave.id}'`);
        } else {
          taskOwners.set(task, wave.id);
        }
      }
      if (wave.strategy === 'parallel' && new Set(wave.tasks).size !== wave.tasks.length) {
        failures.push(`parallel wave '${wave.id}' contains duplicate tasks`);
      }
    }
    if (!Array.isArray(wave.depends_on)) failures.push(`${label} depends_on must be an array`);
    else if (wave.depends_on.some(id => !isNonEmptyText(id))) failures.push(`${label} dependencies must be non-empty strings`);
  }

  for (const wave of plan.waves.filter(isObject)) {
    if (!Array.isArray(wave.depends_on) || !isNonEmptyText(wave.id)) continue;
    for (const dependency of wave.depends_on) {
      if (dependency === wave.id) failures.push(`wave '${wave.id}' cannot depend on itself`);
      else if (isNonEmptyText(dependency) && !ids.has(dependency)) {
        failures.push(`wave '${wave.id}' depends on unknown wave '${dependency}'`);
      }
    }
  }
  const canCheckCycles = plan.waves.every(wave => isObject(wave)
    && isNonEmptyText(wave.id) && Array.isArray(wave.depends_on));
  if (canCheckCycles && !failures.some(failure => /duplicate wave id|unknown wave|cannot depend on itself/.test(failure))
    && hasDependencyCycle(plan.waves)) {
    failures.push('execution plan waves contain a dependency cycle');
  }
  return failures;
}

function hasDependencyCycle(waves) {
  const dependencies = new Map(waves.map(wave => [wave.id, wave.depends_on]));
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependencies.get(id) || []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...dependencies.keys()].some(visit);
}

function hashPlan(plan) {
  const { hash, ...content } = plan;
  return `sha256:${createHash('sha256').update(stableJson(content)).digest('hex')}`;
}

function tryHashPlan(plan) {
  if (!isObject(plan)) return null;
  try {
    return hashPlan(plan);
  } catch {
    return null;
  }
}

function stableJson(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) throw new Error('circular plan data');
  seen.add(value);
  if (Array.isArray(value)) {
    const result = `[${value.map(item => stableJson(item, seen)).join(',')}]`;
    seen.delete(value);
    return result;
  }
  const result = `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key], seen)}`).join(',')}}`;
  seen.delete(value);
  return result;
}

function writeExecutionPlanSummary(changeDir, plan) {
  const statePath = join(changeDir, '.spec-superflow.yaml');
  const state = readState(changeDir);
  const original = existsSync(statePath)
    ? readFileSync(statePath, 'utf8')
    : `state: ${state.state}\nworkflow: ${state.workflow}\n`;
  const content = [
    ['revision', plan.revision],
    ['execution_mode', plan.mode],
    ['execution_plan_hash', plan.hash],
    ['execution_plan_revision', plan.revision],
  ].reduce((current, [field, value]) => setStateField(current, field, value), original);
  atomicWrite(statePath, content);
}

function setStateField(content, field, value) {
  const line = `${field}: ${value}`;
  const expression = new RegExp(`^${field}:\\s*.*$`, 'm');
  return expression.test(content)
    ? content.replace(expression, line)
    : `${content.replace(/\n*$/, '\n')}\n${line}\n`;
}

function atomicWrite(targetPath, content) {
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tempPath, content, 'utf8');
  renameSync(tempPath, targetPath);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableHash(value) {
  return value === null || (typeof value === 'string' && value.startsWith('sha256:'));
}

function requireText(value, field) {
  if (!isNonEmptyText(value)) throw new Error(`${field} is required`);
}

function safeFileName(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}
