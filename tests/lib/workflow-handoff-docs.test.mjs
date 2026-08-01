// Documentation contract for Wave 2 Task 2.1: every workflow skill gives a
// concise, consistent user-facing handoff at normal, blocked, and approval gates.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SKILLS = [
  'workflow-start',
  'need-explorer',
  'spec-writer',
  'contract-builder',
  'build-executor',
  'bug-investigator',
  'code-reviewer',
  'release-archivist',
  'spec-merger',
];

function readSkill(skill) {
  return readFileSync(join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
}

function handoffSection(content) {
  const heading = '## Standard User-Facing Handoff';
  const start = content.indexOf(heading);
  assert.notEqual(start, -1, 'missing standard handoff section');
  const next = content.indexOf('\n## ', start + heading.length);
  return content.slice(start, next === -1 ? undefined : next);
}

describe('workflow handoff documentation contract', () => {
  it('gives all nine workflow skills the same four-field handoff for normal, blocked, and approval waits', () => {
    for (const skill of SKILLS) {
      const handoff = handoffSection(readSkill(skill));

      for (const scenario of ['Normal report', 'Blocked report', 'Approval-wait report']) {
        assert.match(handoff, new RegExp(`### ${scenario}`),
          `${skill} must cover ${scenario.toLowerCase()}`);
      }
      for (const field of ['Current stage:', 'Completed / blocker:', 'Next stage:', 'Entry condition:']) {
        assert.match(handoff, new RegExp(field), `${skill} must include ${field}`);
      }
    }
  });

  it('keeps only successfully persisted closing and abandoned terminal with next stage none', () => {
    for (const skill of SKILLS) {
      const handoff = handoffSection(readSkill(skill));
      assert.match(handoff, /only.*successfully persisted `closing`.*`abandoned`.*terminal/is,
        `${skill} must limit terminal status to persisted closing and abandoned`);
      assert.match(handoff, /Successful terminal report[\s\S]*?Current stage: successfully persisted `closing` or `abandoned`[\s\S]*?Next stage: `none`/,
        `${skill} must report terminal next stage as none`);
    }
  });

  it('treats release and archive work before closing as a continuing stage', () => {
    const archivist = handoffSection(readSkill('release-archivist'));
    const merger = handoffSection(readSkill('spec-merger'));

    for (const [skill, handoff] of [
      ['release-archivist', archivist],
      ['spec-merger', merger],
    ]) {
      assert.match(handoff, /Closing-in-progress report/,
        `${skill} must distinguish closing in progress`);
      assert.match(handoff, /Current stage: `executing`.*release.*archive.*still.*running/is,
        `${skill} must keep release work in executing`);
      assert.match(handoff, /Next stage: .*not.*`none`/is,
        `${skill} must retain a next stage before closing persists`);
      assert.match(handoff, /Entry condition: .*release.*archive.*complete.*transition.*succeeds/is,
        `${skill} must require successful release completion before terminal close`);
    }
  });
});
