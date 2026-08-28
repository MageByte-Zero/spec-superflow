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
  const previousRepair = readRepairState(changeDir, plan, waveId);
  if (previousRepair?.status === 'adjudication-required') {
    throw new Error(`Wave '${waveId}' requires adjudication before another review can be recorded`);
  }
  if (previousReceipt?.status === 'pass') {
    throw new Error(`Wave '${waveId}' already has a passing review receipt`);
  }
  validateRepairContinuity(previousReceipt, previousRepair, { status: receipt.status, base, head, report: reportEvidence.path });

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
  if (savedReceipt.status === 'pass') {
    // Task briefs, diff packages, and progress notes are regenerable for this
    // exact plan. Receipt and repair evidence deliberately live beside, not in,
    // this directory and must remain available to closing/repair guards.
    rmSync(getPlanScopedPaths(changeDir, plan).workspace, { recursive: true, force: true });
  }
  return savedReceipt;
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

  const failedWaves = (plan.waves ?? [])
    .filter(wave => readCurrentReviewEvidence(changeDir, wave.id, plan).receipt?.status === 'fail')
    .map(wave => wave.id);
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
    const previousIdentity = getPlanScopedPaths(changeDir, plan);

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
    );
    migrateReceiptsPlanHashWithUndo(
      [previousIdentity.repairState],
      new Set([migratedIdentity.repairState, previousIdentity.repairState]),
      writeWithUndo,
      plan,
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
function migrateReceiptsPlanHashWithUndo(sourceDirectories, targetDirectories, writeWithUndo, plan) {
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
      if (!isObject(record) || record.plan_revision !== plan.revision || record.plan_hash === plan.hash) continue;
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

// Moves one plan-scoped record directory (checkpoints/handoffs/workspace) onto
// the resynced identity. These records contain no plan_hash fields, so a whole
// directory move preserves them exactly as recorded. Each completed move is
// recorded in the undo log as {path, previousContent: null, restore} so the
// catch-side replay can restore the pre-move layout.
function migratePlanScopedDirectoryWithUndo(source, target, undoLog) {
  if (!existsSync(source)) return;
  if (existsSync(target)) {
    const movedEntries = [];
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const destination = join(target, entry.name);
      rmSync(destination, { recursive: true, force: true });
      renameSync(join(source, entry.name), destination);
      movedEntries.push({ from: destination, to: join(source, entry.name) });
    }
    undoLog.push({
      path: target,
      previousContent: null,
      restore: () => {
        // I1：旧身份父目录可能已被 removeDirIfEmpty 清掉，逆序搬回前先 mkdir 兜底。
        mkdirSync(source, { recursive: true });
        for (const moved of [...movedEntries].reverse()) {
          renameSync(moved.from, moved.to);
        }
      },
    });
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
    const repair = describeRepairState(changeDir, plan, wave.id, receipt);
    const retryable = receipt?.status === 'fail' && repair.status !== 'adjudication-required';
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
    };
  });
}

function validateRepairContinuity(previousReceipt, previousRepair, nextReceipt) {
  if (previousReceipt?.status !== 'fail') return;
  const previousHead = previousRepair?.previous_head ?? previousReceipt.head;
  if (!previousHead) throw new Error('Repair state is missing the previous review head');

  // A failed re-review must examine a repair that starts at the prior review
  // head. A pass may also certify the exact original range: this preserves the
  // established fail→pass receipt flow for a corrected review finding.
  const repeatsPreviousRange = nextReceipt.status === 'pass'
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
    const failures = [...priorFailures, reviewEvidence(receipt)];
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
      resolution: reviewEvidence(receipt),
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

function reviewEvidence(receipt) {
  return {
    base: receipt.base,
    head: receipt.head,
    report: receipt.report,
    recorded_at: receipt.recorded_at,
  };
}

function readRepairState(changeDir, plan, waveId) {
  if (!plan) return null;
  const statePath = join(getPlanScopedPaths(changeDir, plan).repairState, `${safeFileName(waveId)}.json`);
  if (!existsSync(statePath)) return null;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (state?.plan_hash !== plan.hash || state?.plan_revision !== plan.revision || state?.wave_id !== waveId) return null;
    if (!['repairing', 'resolved', 'adjudication-required'].includes(state.status)) return null;
    if (!Number.isInteger(state.failure_count) || state.failure_count < 1 || !Array.isArray(state.failures)
      || state.failures.length !== state.failure_count || !isNonEmptyText(state.previous_head)
      || !isNonEmptyText(state.previous_report)) return null;
    return state;
  } catch {
    return null;
  }
}

function describeRepairState(changeDir, plan, waveId, receipt) {
  const state = readRepairState(changeDir, plan, waveId);
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
