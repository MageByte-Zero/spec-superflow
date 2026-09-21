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
    assert.match(chineseReadme, /workflow complete.*最终验证.*planned.*任务.*最终审查.*delta spec.*同步/is);
    assert.match(englishReadme, /workflow complete.*final verification.*Planned.*completed tasks.*final review.*delta specs/is);
    assert.match(chineseReadme, /accepted-risk.*不会自动合并/is);
    assert.match(englishReadme, /accepted-risk.*not integrated automatically/is);
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
