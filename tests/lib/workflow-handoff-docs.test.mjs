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

describe('concise workflow handoff documentation', () => {
  it('does not duplicate a mandatory report template across skills', () => {
    for (const skill of SKILLS) assert.doesNotMatch(readSkill(skill), /## Standard User-Facing Handoff/);
    assert.match(readSkill('workflow-start'), /Progress updates.*one short paragraph/is);
    assert.match(readSkill('workflow-start'), /Continue authorized internal work/is);
  });
  it('distinguishes logical closure from pending physical finish', () => {
    assert.match(readSkill('release-archivist'), /logical closure.*does not claim merge/is);
    assert.match(readSkill('release-archivist'), /Cleanup failure remains cleanup-pending/i);
  });
});
