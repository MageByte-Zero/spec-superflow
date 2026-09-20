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
  it('routes only pending physical finish after logical closing', () => {
    const workflow = read('skills/workflow-start/SKILL.md');
    const release = read('skills/release-archivist/SKILL.md');
    assert.match(workflow, /closing.*logical completion/is);
    assert.match(workflow, /physical finish pending.*release-archivist/is);
    assert.match(release, /closing.*only recorded pending physical finish/is);
    assert.match(release, /merge.*authorized/is);
  });

  it('keeps spec synchronization and audit before logical closure', () => {
    const release = read('skills/release-archivist/SKILL.md');
    assert.ok(release.indexOf('Synchronize actual delta') < release.indexOf('ssf state transition'));
    assert.ok(release.indexOf('ssf audit') < release.indexOf('ssf state transition'));
    const merger = section(read('skills/spec-merger/SKILL.md'), '## Execution-State Guard');
    assert.match(merger, /exactly.*`executing`/i);
    assert.match(merger, /closing.*STOP/is);
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

    // The #64 repair must remain in its v0.11.0 record; [Unreleased] may carry
    // other pending changes (e.g. the CodeBuddy installer), so we only assert
    // the #64 repair was not leaked into [Unreleased].
    assert.doesNotMatch(unreleased, /#64/, 'the #64 repair must stay in v0.11.0, not in [Unreleased]');
    assert.match(repairedRelease, /#64/);
    assert.match(repairedRelease, /closing/i);
    assert.match(repairedRelease, /终态/);
  });
});
