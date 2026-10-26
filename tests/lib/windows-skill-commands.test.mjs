import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const timestampSkills = [
  ['docs/legacy-workflow.md', 'dp_0_timestamp'],
  ['docs/legacy-workflow.md', 'dp_1_timestamp'],
  ['docs/legacy-workflow.md', 'dp_2_timestamp'],
  ['skills/contract-builder/SKILL.md', 'dp_3_timestamp'],
  ['docs/legacy-workflow.md', 'dp_6_timestamp'],
  ['docs/legacy-workflow.md', 'dp_7_timestamp'],
];

describe('cross-platform skill commands', () => {
  it('delegates decision-point timestamp generation to the ssf CLI', () => {
    for (const [file, field] of timestampSkills) {
      const content = readFileSync(join(process.cwd(), file), 'utf8');
      assert.doesNotMatch(content, /\$\(date -u /, `${file} must not require a POSIX shell timestamp`);
      assert.match(content, new RegExp(`SSF state set <change-dir> ${field} now`));
    }
  });
});
