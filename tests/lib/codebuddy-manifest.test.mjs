// tests/lib/codebuddy-manifest.test.mjs
// Root marketplace manifests must enumerate skills for CodeBuddy discovery.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const EXPECTED_SKILLS = [
  'bug-investigator',
  'build-executor',
  'code-reviewer',
  'contract-builder',
  'need-explorer',
  'release-archivist',
  'spec-merger',
  'spec-writer',
  'workflow-start',
];

describe('CodeBuddy marketplace manifest', () => {
  it('enumerates every skill as a discoverable plugin path', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'plugin.json'), 'utf8'));

    assert.deepEqual(manifest.skills, EXPECTED_SKILLS.map(name => `./skills/${name}`));
    for (const skillPath of manifest.skills) {
      assert.ok(existsSync(join(ROOT, skillPath, 'SKILL.md')), `${skillPath} must contain SKILL.md`);
    }
  });
});
