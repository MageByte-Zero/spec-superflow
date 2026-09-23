import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('workflow-start path recommendation protocol', () => {
  it('infers known facts and preserves user choice without a questionnaire', () => {
    const skill = read('skills/workflow-start/SKILL.md');
    assert.match(skill, /Infer scope and risks/i);
    assert.match(skill, /do not turn CLI fields into a questionnaire/i);
    assert.match(skill, /same turn/i);
    assert.match(skill, /workflow accept.*--verification/i);
    assert.match(skill, /Reuse authorization already given/i);
    assert.match(skill, /nonrecommended choice requires acknowledgment/i);
  });
  it('validates and initializes before recommending a new change', () => {
    const skill = read('skills/workflow-start/SKILL.md');
    assert.match(skill, /single safe relative path segment under `changes\//);
    assert.ok(skill.indexOf('SSF state init') < skill.indexOf('SSF workflow recommend'));
    assert.match(skill, /Never infer approval from artifact existence/i);
  });

  it('documents intake selection separately from DP-4 execution mode', () => {
    const decisions = read('docs/decision-points.md');

    assert.match(decisions, /full.*hotfix.*tweak/s);
    assert.match(decisions, /默认 Native/);
    assert.match(decisions, /只有用户明确选择委派才启用 `SDD`/);
    assert.match(decisions, /`Batch Inline` 保留串行兼容/);
    assert.match(decisions, /\.superpowers\/sdd\/workflow-selection\.json/);
    assert.match(decisions, /\.spec-superflow\.yaml[^\n]*dp_0_[^\n]*(?:scope|artifact_language)/);
  });

  it('documents Full/legacy DP-0 triggers and fast-path exemptions', () => {
    const decisions = read('docs/decision-points.md');
    const trigger = decisions.match(/- \*\*触发条件\*\*：([^\n]+)/)?.[1] ?? '';

    assert.match(trigger, /Full/i);
    assert.match(trigger, /legacy/i);
    assert.match(trigger, /Quick/i);
    assert.match(trigger, /direct Hotfix/i);
    assert.match(trigger, /Tweak/i);
    assert.doesNotMatch(trigger, /auto|空|empty/i);
  });
});
