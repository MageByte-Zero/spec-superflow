// Contract tests for #64: closing is a successful terminal state.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const RUNTIME_PREFIX = 'ssf';

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function section(content, heading) {
  const start = content.indexOf(heading);
  assert.notEqual(start, -1, `missing section: ${heading}`);
  const next = content.indexOf('\n## ', start + heading.length);
  return content.slice(start, next === -1 ? undefined : next);
}

describe('closing terminal lifecycle', () => {
  it('short-circuits closing before recovery overlays and returns no next skill', () => {
    const workflow = read('skills/workflow-start/SKILL.md');
    const terminal = section(workflow, '## Terminal-State Short Circuit');
    const updateCheck = workflow.indexOf('1. **Update check**');
    const recovery = workflow.indexOf('## Overlay Recovery Scan');
    const executionControl = workflow.indexOf('## Execution-Control Recovery Scan');

    for (const [marker, index] of [
      ['update check', updateCheck],
      ['overlay recovery', recovery],
      ['execution-control recovery', executionControl],
    ]) {
      assert.notEqual(index, -1, `workflow must include ${marker}`);
      assert.ok(workflow.indexOf('## Terminal-State Short Circuit') < index,
        `terminal short circuit must run before ${marker}`);
    }
    assert.match(terminal, /closing.*terminal/i);
    assert.match(terminal, /next skill.*none/i);
    assert.match(terminal,
      /do not run.*handoff.*checkpoint.*execution-control.*release-archivist/is);
  });

  it('performs archival verification and delta merging while executing before its final transition', () => {
    const archivist = read('skills/release-archivist/SKILL.md');
    const merger = read('skills/spec-merger/SKILL.md');

    assert.match(archivist, /state.*executing/i);
    assert.match(archivist, /spec-merger.*before.*executing\s*→\s*closing/is);
    assert.match(archivist, /executing\s*→\s*closing.*final/i);
    assert.match(merger, /executing\s*→\s*closing/i);
    assert.match(merger, /closing.*must not.*route.*spec-merger/is);
  });

  it('stops pre-closing skills on a persisted non-executing state before side effects', () => {
    const archivist = read('skills/release-archivist/SKILL.md');
    const merger = read('skills/spec-merger/SKILL.md');
    const archivistGuard = section(archivist, '## Execution-State Guard');
    const mergerGuard = section(merger, '## Execution-State Guard');

    for (const [name, guard] of [
      ['release-archivist', archivistGuard],
      ['spec-merger', mergerGuard],
    ]) {
      assert.match(guard, /ssf state get <change-dir> state/,
        `${name} must inspect the persisted state`);
      assert.match(guard, /exactly.*`executing`/i,
        `${name} must allow only executing`);
      assert.match(guard, /closing.*STOP/is,
        `${name} must stop for the terminal closing state`);
      assert.match(guard, /any other.*state.*STOP/is,
        `${name} must stop for every other non-executing state`);
    }

    assert.ok(merger.indexOf('## Execution-State Guard') < merger.indexOf('ssf sync'),
      'spec-merger must guard before sync can write main specs');
    for (const sideEffect of [
      '### Step 1: Test Suite',
      'ssf audit',
      'ssf state set <change-dir> dp_6_result',
      'ssf state set <change-dir> dp_7_result',
      'invoke `spec-merger`',
    ]) {
      assert.notEqual(archivist.indexOf(sideEffect), -1,
        `release-archivist fixture must include ${sideEffect}`);
      assert.ok(archivist.indexOf('## Execution-State Guard') < archivist.indexOf(sideEffect),
        `release-archivist must guard before ${sideEffect}`);
    }
  });

  it('places the release guard before every closing side effect and makes transition last', () => {
    const archivist = read('skills/release-archivist/SKILL.md');
    const guard = archivist.indexOf('## Execution-State Guard');
    const audit = archivist.indexOf(`${RUNTIME_PREFIX} audit <change-dir>`);
    const dp6 = archivist.indexOf('### DP-6 (Verification Outcome');
    const dp7 = archivist.indexOf('### DP-7 (Archive Confirmation');
    const merger = archivist.indexOf('invoke `spec-merger`');
    const transition = archivist.indexOf(`${RUNTIME_PREFIX} state transition <change-dir> closing`);

    for (const [marker, index] of [
      ['release guard', guard],
      ['audit command', audit],
      ['DP-6', dp6],
      ['DP-7', dp7],
      ['spec-merger', merger],
      ['final transition', transition],
    ]) {
      assert.notEqual(index, -1, `release-archivist must include ${marker}`);
    }

    assert.ok(guard < audit, 'release guard must run before the actual audit command');
    assert.ok(audit < dp6, 'actual audit command must run before DP-6');
    assert.ok(dp6 < dp7, 'DP-6 must be recorded before DP-7');
    assert.ok(dp7 < merger, 'DP-7 must be recorded before invoking spec-merger');
    assert.ok(merger < transition, 'spec-merger must run before the actual final transition');
    assert.equal(
      archivist.split(`${RUNTIME_PREFIX} state transition <change-dir> closing`).length - 1,
      1,
      'the actual final transition command must occur exactly once'
    );
  });

  it('defines closing as a successful terminal state with no active archivist', () => {
    const stateMachine = read('docs/state-machine.md');
    const closing = section(stateMachine, '### `closing`');

    assert.match(closing, /successful terminal/i);
    assert.doesNotMatch(closing, /release-archivist.*active/i);
  });

  it('draws scope-change rewind only from non-terminal states and starts a new change after closing', () => {
    const stateMachine = read('docs/state-machine.md');
    const transitions = section(stateMachine, '## Transitions');

    assert.doesNotMatch(transitions, /closing\s*(?:→|->|─+>)\s*specifying/i,
      'formal diagram must not draw a closing → specifying arrow');
    assert.match(transitions, /scope change.*non-terminal.*re-specify/is,
      'formal diagram must limit scope-change rewind to non-terminal states');
    assert.match(transitions, /closing.*scope change.*new change/is,
      'formal diagram must direct post-closing scope changes to a new change');
  });

  it('documents pre-closing work before the terminal closing state', () => {
    const chineseReadme = read('README.md');
    const englishReadme = read('docs/README_en.md');
    const chineseWorkflow = section(chineseReadme, '## 工作流');
    const englishWorkflow = section(englishReadme, '## Workflow');

    assert.match(chineseReadme,
      /\| 8 \| `release-archivist` \| 执行内收尾 \|/);
    assert.doesNotMatch(chineseReadme,
      /\| 8 \| `release-archivist` \| 收口 \|/);
    assert.match(englishReadme,
      /\| 8 \| `release-archivist` \| Pre-closing within executing \|/);
    assert.doesNotMatch(englishReadme,
      /\| 8 \| `release-archivist` \| Closing \|/);
    assert.match(chineseReadme,
      /\| 9 \| `spec-merger` \| 执行内收尾 \|/);
    assert.doesNotMatch(chineseReadme,
      /\| 9 \| `spec-merger` \| 同步 \|/);
    assert.match(englishReadme,
      /\| 9 \| `spec-merger` \| Pre-closing within executing \|/);
    assert.doesNotMatch(englishReadme,
      /\| 9 \| `spec-merger` \| Syncing \|/);
    assert.match(chineseWorkflow,
      /^\s*pre-closing（仍属于 executing 的收尾步骤，不是新增状态）$/m);
    assert.match(englishWorkflow,
      /^\s*pre-closing \(a wrap-up step within executing, not a ninth state\)$/m);

    for (const [name, workflow, archivist, merger, archive] of [
      ['Chinese README', chineseWorkflow, 'release-archivist 验证', 'spec-merger 同步', '归档确认'],
      ['English README', englishWorkflow, 'release-archivist verifies', 'spec-merger sync', 'archive confirmation'],
    ]) {
      const archivistIndex = workflow.indexOf(archivist);
      const mergerIndex = workflow.indexOf(merger);
      const archiveIndex = workflow.indexOf(archive);
      const closingIndex = workflow.indexOf('\n   closing');

      assert.ok(archivistIndex !== -1 && archivistIndex < mergerIndex,
        `${name} must describe release-archivist verification before spec sync`);
      assert.ok(mergerIndex < archiveIndex && archiveIndex < closingIndex,
        `${name} must describe spec sync and archive confirmation before closing`);
      assert.doesNotMatch(workflow, /^\s*closing\s+.*release-archivist/im,
        `${name} must not place release-archivist in closing`);
      assert.match(workflow, /closing.*(?:CLOSED|terminal|终态)/i,
        `${name} must describe closing as terminal`);
    }
  });

  it('keeps the #64 terminal closing repair in its v0.11.0 release record', () => {
    const changelog = read('CHANGELOG.md');
    const unreleased = section(changelog, '## [Unreleased]');
    const repairedRelease = section(changelog, '## [0.11.0] - 2026-07-21');

    assert.equal(unreleased.trim(), '## [Unreleased]');
    assert.match(repairedRelease, /#64/);
    assert.match(repairedRelease, /closing/i);
    assert.match(repairedRelease, /终态/);
  });
});
