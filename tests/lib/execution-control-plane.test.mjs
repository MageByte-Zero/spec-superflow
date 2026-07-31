import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRecoverySummary } from '../../scripts/lib/change-recovery.mjs';
import { saveCheckpoint } from '../../scripts/lib/sdd-overlay.mjs';

const root = process.cwd();
const read = path => readFileSync(join(root, path), 'utf8');

describe('execution control plane instructions', () => {
  it('recovers only a legacy checkpoint whose hash and revision prove it belongs to the current plan', () => {
    const changeDir = mkdtempSync(join(tmpdir(), 'execution-control-plan-'));
    const currentHash = `sha256:${'c'.repeat(64)}`;
    try {
      writeFileSync(join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Resume the current plan\n- [ ] 1.2 Ignore stale evidence\n');
      writeFileSync(join(changeDir, '.spec-superflow.yaml'), 'state: executing\nworkflow: full\nrevision: 2\n');

      saveCheckpoint(changeDir, { taskId: '1.1', next: 'Resume the proven plan checkpoint' });
      saveCheckpoint(changeDir, { taskId: '1.2', next: 'Do not resume stale evidence' });
      stampLegacyCheckpoint(changeDir, '1.1', currentHash, 2, '2000-01-01T00:00:00.000Z');
      stampLegacyCheckpoint(changeDir, '1.2', `sha256:${'d'.repeat(64)}`, 1, '2999-01-01T00:00:00.000Z');

      const root = join(changeDir, '.superpowers', 'sdd');
      writeFileSync(join(root, 'execution-plan.json'), `${JSON.stringify({
        hash: currentHash,
        revision: 2,
      })}\n`);

      const summary = createRecoverySummary(changeDir);
      assert.equal(summary.checkpoint?.status, 'current');
      assert.equal(summary.checkpoint?.record.task_id, '1.1');
      assert.equal(summary.checkpoint?.record.next, 'Resume the proven plan checkpoint');
    } finally {
      rmSync(changeDir, { recursive: true, force: true });
    }
  });

  it('limits planning and review receipts to Full and legacy Hotfix', () => {
    for (const path of [
      'skills/workflow-start/SKILL.md',
      'skills/build-executor/SKILL.md',
      'skills/contract-builder/SKILL.md',
      'skills/release-archivist/SKILL.md',
    ]) {
      const content = read(path);
      assert.match(content, /Quick.*direct|direct.*Quick/is, `${path} publishes Quick direct execution`);
      assert.match(content, /legacy Hotfix/is, `${path} distinguishes legacy Hotfix`);
      assert.match(content, /test_result.*pass/is, `${path} requires a persisted short-path verification result`);
    }
  });
  it('publishes direct-path semantics in user documentation', () => {
    for (const path of ['README.md', 'INSTALL.md', 'docs/README_en.md', 'docs/state-machine.md', 'docs/artifact-contract.md', 'docs/decision-points.md']) {
      const content = read(path);
      assert.match(content, /Quick/);
      assert.match(content, /direct Hotfix/i);
      assert.match(content, /legacy Hotfix/i);
      assert.match(content, /test_result.*pass/is);
    }
  });
  it('documents #45 guarded execution', () => {
    const documents = [
      'README.md',
      'docs/README_en.md',
      'INSTALL.md',
      'templates/execution-contract.md',
      'docs/state-machine.md',
      'docs/artifact-contract.md',
    ];

    for (const path of documents) {
      const content = read(path);
      assert.match(content, /execution[ -]plan/i, `${path} documents execution plans`);
      assert.match(content, /execution recommend|execution-recommendation|执行模式推荐/i, `${path} documents execution-mode recommendations`);
      assert.match(content, /execution-recommendation\.json|recommendation receipt|推荐凭据/i, `${path} documents persisted recommendation evidence`);
      assert.match(content, /--confirm|用户.*确认|user.*confirm/is, `${path} documents user confirmation`);
      assert.match(content, /acknowledge-recommendation|确认.*风险|acknowledg/is, `${path} documents acknowledgement for a non-recommended choice`);
      assert.match(content, /review receipt/i, `${path} documents review receipts`);
    }

    assert.match(read('templates/execution-contract.md'), /Execution Waves/);
    assert.match(read('CHANGELOG.md'), /#45/);
    for (const path of documents) {
      assert.doesNotMatch(read(path), /automatic(?:ally)?\s+(?:defaults?\s+to\s+)?Batch Inline/i,
        `${path} does not advertise automatic Batch Inline`);
    }
  });

  it('documents implemented #47 recovery commands without adding states', () => {
    const chineseDocuments = ['README.md', 'INSTALL.md'];
    for (const path of chineseDocuments) {
      const content = read(path);
      for (const command of ['/ssf:resume', '/ssf:switch', '/ssf:save']) {
        assert.match(content, new RegExp(command.replace('/', '\\/')),
          `${path} publishes ${command}`);
      }
      assert.match(content, /ssf resume.*(?:唯一活跃|恰好一个活跃).*自动选择/is,
        `${path} limits resume auto-selection to the sole active change`);
      assert.match(content, /ssf switch.*只读.*恢复上下文/is,
        `${path} documents switch as read-only recovery context`);
      assert.match(content, /switch.*不修改 cwd、TUI 会话或任何隐藏指针.*CLI 本身不.*当前对话关注对象/is,
        `${path} keeps switch from mutating environment or conversation focus`);
      assert.match(content, /save.*(?:既有|已有).*checkpoint.*不自动 commit、push 或 sync/is,
        `${path} limits save to the existing checkpoint without automatic Git or sync effects`);
      assert.match(content, /CodeBuddy\/WorkBuddy.*不为其他平台承诺完全相同的 slash 名称/is,
        `${path} scopes slash adapters to CodeBuddy/WorkBuddy`);
    }

    const english = read('docs/README_en.md');
    for (const command of ['/ssf:resume', '/ssf:switch', '/ssf:save']) {
      assert.match(english, new RegExp(command.replace('/', '\\/')),
        `docs/README_en.md publishes ${command}`);
    }
    assert.match(english, /ssf resume.*exactly one active change/is,
      'English docs limit resume auto-selection to the sole active change');
    assert.match(english, /ssf switch.*read-only recovery context/is,
      'English docs describe switch as read-only recovery context');
    assert.match(english, /switch.*never changes cwd, a TUI session, or a hidden pointer.*CLI itself does not.*conversation focus/is,
      'English docs keep switch from mutating environment or conversation focus');
    assert.match(english, /save.*existing checkpoint.*never commits, pushes, or syncs automatically/is,
      'English docs limit save to the existing checkpoint without automatic Git or sync effects');
    assert.match(english, /CodeBuddy\/WorkBuddy.*not promised identical slash names/is,
      'English docs scope slash adapters to CodeBuddy/WorkBuddy');

    for (const path of [
      'README.md',
      'docs/README_en.md',
      'INSTALL.md',
      'docs/state-machine.md',
      'docs/artifact-contract.md',
    ]) {
      assert.doesNotMatch(read(path),
        /(?:#47|recovery|恢复|slash).{0,200}(?:not implemented|未实现)|(?:not implemented|未实现).{0,200}(?:#47|recovery|恢复|slash)/is,
        `${path} does not claim #47 recovery or slash commands are unimplemented`);
    }

    const stateMachine = read('docs/state-machine.md');
    assert.match(stateMachine, /control[- ]plane overlay/is,
      'state machine calls recovery a control-plane overlay');
    assert.match(stateMachine, /do not create a ninth\s+workflow\s+state/is,
      'state machine rejects a ninth workflow state');

    const artifactContract = read('docs/artifact-contract.md');
    assert.match(artifactContract, /resume.*switch.*read-only/is,
      'artifact contract keeps resume and switch read-only');
    assert.match(artifactContract, /save.*existing checkpoint save protocol/is,
      'artifact contract writes save through the existing checkpoint protocol');

    const releaseChecklist = read('docs/release-checklist.md');
    assert.match(releaseChecklist, /SSF_WORKBUDDY_SMOKE_HOME="\$\(mktemp -d\)"/,
      'release checklist creates a task-specific temporary WorkBuddy home');
    assert.match(releaseChecklist,
      /node scripts\/spec-superflow\.mjs install-workbuddy --local "\$PWD" --home "\$SSF_WORKBUDDY_SMOKE_HOME"/,
      'release checklist installs the local candidate into that temporary home');
    assert.match(releaseChecklist, /cmd-install-workbuddy\.test\.mjs/,
      'release checklist validates the installer with its focused test');
    assert.match(releaseChecklist,
      /node --test tests\/lib\/recovery-command-assets\.test\.mjs.*(?:release blocker|阻断发布)/is,
      'release checklist runs the recovery command asset guard as a release blocker');
    assert.match(releaseChecklist,
      /grep -R -F "\$PWD\/" commands\/ssf/is,
      'release checklist rejects the local checkout root in canonical command files');
    assert.match(releaseChecklist,
      /grep -R -F "\$PWD\/" "\$SSF_WORKBUDDY_PLUGIN\/commands\/ssf"/is,
      'release checklist rejects the local checkout root in installed command files');
    for (const [asset, assertion] of [
      ['commands/ssf/resume.md', /test -f "\$SSF_WORKBUDDY_PLUGIN\/commands\/ssf\/resume\.md"/],
      ['commands/ssf/switch.md', /test -f "\$SSF_WORKBUDDY_PLUGIN\/commands\/ssf\/switch\.md"/],
      ['commands/ssf/save.md', /test -f "\$SSF_WORKBUDDY_PLUGIN\/commands\/ssf\/save\.md"/],
    ]) {
      assert.match(releaseChecklist, assertion, `release checklist asserts ${asset}`);
    }
    assert.match(releaseChecklist,
      /find "\$SSF_WORKBUDDY_PLUGIN\/skills".*-type d.*= 9/is,
      'release checklist asserts all nine skills');
    for (const runtimeDir of ['scripts', 'docs', 'templates', 'dist', 'hooks']) {
      assert.match(releaseChecklist,
        new RegExp(`test -d "\\$SSF_WORKBUDDY_PLUGIN/${runtimeDir}"`),
        `release checklist validates ${runtimeDir}`);
    }
    assert.match(releaseChecklist, /test -f "\$SSF_WORKBUDDY_PLUGIN\/rules\/phase-guard\.md"/,
      'release checklist validates the WorkBuddy rule');
    assert.match(releaseChecklist, /test -f "\$SSF_WORKBUDDY_PLUGIN\/\.codebuddy-plugin\/plugin\.json"/,
      'release checklist validates the plugin manifest');
    assert.match(releaseChecklist,
      /enabledPlugins.*spec-superflow@cb_teams_marketplace.*SSF_WORKBUDDY_SMOKE_HOME\/\.workbuddy\/settings\.json/is,
      'release checklist validates the enabled-plugin setting');
    assert.match(read('CHANGELOG.md'), /#47/);
  });

  it('documents only the persisted execution-plan contract that #45 implements', () => {
    const documents = [
      'README.md',
      'docs/README_en.md',
      'INSTALL.md',
      'templates/execution-contract.md',
      'docs/state-machine.md',
      'docs/artifact-contract.md',
      'CHANGELOG.md',
    ];

    for (const path of documents) {
      const content = read(path);
      assert.match(content, /\.superpowers\/sdd\/execution-plan\.json/,
        `${path} identifies the persisted execution-plan path`);
      assert.doesNotMatch(content, /write[- ]?conflict/i,
        `${path} does not claim an unpersisted write-conflict check`);
    }

    for (const path of ['README.md', 'docs/README_en.md', 'INSTALL.md']) {
      const content = read(path);
      assert.match(content, /execution revise/i, `${path} documents execution revise`);
      assert.match(content,
        /retains?\/upgrades?.*sdd.*replan|inline\/batch-inline.*(?:upgrades?|升级).*sdd.*(?:or|或).*(?:replans?|重规划).*sdd/is,
        `${path} allows SDD replanning while retaining the no-downgrade contract`);
      assert.match(content, /downgrade|降级/i, `${path} keeps SDD downgrade rejection explicit`);
    }

    assert.match(read('scripts/spec-superflow.mjs'), /upgrade inline\/batch.*replan existing sdd.*new revision/is,
      'CLI help describes SDD replanning instead of only inline upgrades');
  });

  it('documents portable and auditable review receipt evidence', () => {
    const localizedDocuments = ['README.md', 'INSTALL.md'];

    for (const path of localizedDocuments) {
      const content = read(path);
      assert.match(content,
        /--report.*相对于.*<change>.*解析.*<change>\/.superpowers\/sdd\/reviews/is,
        `${path} resolves review reports from the change directory into its reviews overlay`);
      assert.match(content, /--base.*--head.*真实.*commit/is,
        `${path} requires real commits for review ranges`);
      assert.match(content, /<change>.*Git.*工作树/is,
        `${path} binds review ranges to the change worktree`);
      assert.match(content, /base.*head.*祖先/is,
        `${path} requires base to precede head`);
      assert.match(content,
        /<change>\/.superpowers\/sdd\/reviews\/.*物理.*非符号链接/is,
        `${path} requires physical, non-symlink review overlay directories`);
      assert.match(content,
        /report.*普通.*非空.*非符号链接.*文件/is,
        `${path} requires review reports to be regular, non-empty, non-symlink files`);
    }

    const english = read('docs/README_en.md');
    assert.match(english,
      /--report.*resolved relative to.*<change>.*must remain under.*<change>\/.superpowers\/sdd\/reviews/is,
      'English documentation resolves review reports from the change directory into its reviews overlay');
    assert.match(english, /--base.*--head.*real commits/is,
      'English documentation requires real commits for review ranges');
    assert.match(english, /<change>.*Git worktree/is,
      'English documentation binds review ranges to the change worktree');
    assert.match(english, /base.*ancestor.*head/is,
      'English documentation requires base to precede head');
    assert.match(english,
      /<change>\/.superpowers\/sdd\/reviews\/.*physical.*non-symlink/is,
      'English documentation requires physical, non-symlink review overlay directories');
    assert.match(english,
      /report.*regular.*non-empty.*non-symlink.*file/is,
      'English documentation requires review reports to be regular, non-empty, non-symlink files');
  });

  it('keeps execution mode and review gates machine-backed in every entry point', () => {
    const workflowStart = read('skills/workflow-start/SKILL.md');
    const buildExecutor = read('skills/build-executor/SKILL.md');
    const codeReviewer = read('skills/code-reviewer/SKILL.md');
    const inject = read('scripts/lib/cmd-inject.mjs');

    assert.match(workflowStart, /execution show <change-dir> --json/);
    assert.match(workflowStart, /execution plan <change-dir>/);
    assert.match(buildExecutor, /execution recommend/i);
    assert.match(buildExecutor, /user.*confirm|用户.*确认/is);
    assert.match(buildExecutor, /acknowledge-recommendation/i);
    assert.match(buildExecutor, /parallel.*wave/is);
    assert.match(buildExecutor, /concurren(?:cy|t).*unavailable/i);
    assert.match(buildExecutor, /retryable.*replacement.*pass/is);
    assert.doesNotMatch(buildExecutor, />3 tasks, same module/);
    assert.match(codeReviewer, /execution review <change-dir>.*--verdict <pass\|fail>/s);
    assert.match(codeReviewer, /Critical\/Important.*fail.*receipt/is);
    assert.match(inject, /execution plan/);
    assert.match(inject, /pass.*review receipts.*closing/is);
    assert.match(buildExecutor, /<wave-id>:<parallel\|serial>:<task,.+>\[:<depends-on/i);
  });

  it('gives every packaged installer the same planned-execution gate', () => {
    for (const path of [
      'scripts/lib/install.mjs',
      'scripts/lib/cmd-install-workbuddy.mjs',
      'scripts/install-cursor.mjs',
      'scripts/install-zcode.mjs',
    ]) {
      const content = read(path);
      assert.match(content, /Full.*legacy Hotfix/is);
      assert.match(content, /Quick.*direct Hotfix.*tweak/is);
      assert.match(content, /test_result: pass/);
    }
  });

  it('keeps task implementer and reviewer prompts aligned with planned waves and receipts', () => {
    const implementer = read('skills/build-executor/implementer-prompt.md');
    const taskReviewer = read('skills/build-executor/task-reviewer-prompt.md');
    const reviewerPrompt = read('skills/code-reviewer/code-reviewer-prompt.md');

    assert.match(implementer, /planned wave/i);
    assert.match(implementer, /implementer report path/i);
    assert.match(taskReviewer, /execution review <change-dir>/);
    assert.match(taskReviewer, /--verdict <pass\|fail>/);
    assert.match(taskReviewer, /review report\s+path/i);
    assert.match(taskReviewer, /persisted.*review report/i);
    assert.match(reviewerPrompt, /execution review <change-dir>/);
    assert.match(reviewerPrompt, /wave ID/i);
    assert.match(reviewerPrompt, /review report\s+path/i);
    assert.match(reviewerPrompt, /persisted.*review report/i);
  });
});

function stampLegacyCheckpoint(changeDir, taskId, planHash, planRevision, createdAt) {
  const checkpointPath = join(changeDir, '.superpowers', 'sdd', 'checkpoints', `${taskId}.md`);
  const record = readFileSync(checkpointPath, 'utf8');
  writeFileSync(checkpointPath, record
    .replace('---\n\n# Checkpoint:', `plan_hash: ${JSON.stringify(planHash)}\nplan_revision: ${JSON.stringify(planRevision)}\ncreated_at: ${JSON.stringify(createdAt)}\n---\n\n# Checkpoint:`));
}
