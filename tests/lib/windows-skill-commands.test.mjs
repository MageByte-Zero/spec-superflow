import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const timestampSkills = [
  ['skills/workflow-start/SKILL.md', 'dp_0_timestamp'],
  ['skills/need-explorer/SKILL.md', 'dp_1_timestamp'],
  ['skills/spec-writer/SKILL.md', 'dp_2_timestamp'],
  ['skills/contract-builder/SKILL.md', 'dp_3_timestamp'],
  ['skills/release-archivist/SKILL.md', 'dp_6_timestamp'],
  ['skills/release-archivist/SKILL.md', 'dp_7_timestamp'],
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
