import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PROFILES = ['mechanical', 'standard', 'strong', 'review'];
const FILES = [
  'skills/build-executor/SKILL.md',
  'CHANGELOG.md',
];

describe('model profile documentation', () => {
  it('names every supported profile in all affected documentation', () => {
    for (const file of FILES) {
      const content = readFileSync(join(ROOT, file), 'utf8');
      for (const profile of PROFILES) {
        assert.match(content, new RegExp(`\\b${profile}\\b`), `${file} must name ${profile}`);
      }
    }
  });

  it('documents read-only resolution without automatic switching', () => {
    const skill = readFileSync(join(ROOT, 'skills/build-executor/SKILL.md'), 'utf8');
    assert.match(skill, /--resolve-model/);
    assert.match(skill, /inherit the host model/);
  });
});
