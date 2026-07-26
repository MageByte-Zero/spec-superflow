import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const AUTO_INTAKE_STEPS = [
  ['explicit workflow', /explicit[^\n]*full[^\n]*hotfix[^\n]*tweak/i],
  ['show receipt', /ssf workflow show/],
  ['only missing facts', /only[^\n]*missing_facts|missing_facts[^\n]*only/i],
  ['recommend', /ssf workflow recommend/],
  ['Observed', /Observed/],
  ['Available', /Available/],
  ['Recommended', /Recommended/],
  ['Why', /Why/],
  ['user choice', /user(?:'s)? explicit path choice/i],
  ['persist selection', /ssf workflow select/],
  ['DP-0 confirmation', /Confirm DP-0/],
  ['confirmed state', /dp_0_confirmed true/],
];

function protocolErrors(source) {
  const errors = [];
  let previousIndex = -1;

  for (const [label, pattern] of AUTO_INTAKE_STEPS) {
    const match = pattern.exec(source);
    if (!match) {
      errors.push(`missing ${label}`);
      continue;
    }
    if (match.index <= previousIndex) errors.push(`${label} is out of order`);
    previousIndex = Math.max(previousIndex, match.index);
  }

  return errors;
}

describe('workflow-start path recommendation protocol', () => {
  it('recommends and directly accepts a clearly bounded quick or incident hotfix in one turn', () => {
    const skill = read('skills/workflow-start/SKILL.md');
    assert.match(skill, /Quick.*Hotfix.*same turn|同轮.*Quick.*Hotfix/is);
    assert.match(skill, /workflow accept <change-dir> --source direct-request/);
    assert.match(skill, /do not collect.*six|不收集.*六项/is);
    assert.match(skill, /≤3.*tasks.*files|3.*tasks.*files/is);
  });
  it('validates and initializes a brand-new change before workflow show', () => {
    const skill = read('skills/workflow-start/SKILL.md');
    const intake = skill.match(/### Workflow Path Intake[\s\S]*?(?=### Confirm DP-0)/)?.[0] ?? '';

    assert.match(intake, /obtain[^\n]*change name/i);
    assert.match(intake, /validate[^\n]*change name/i);
    assert.match(intake, /change dir[^\n]*changes\/<change-name>/i);
    assert.match(intake, /dp_0_confirmed[^\n]*false[^\n]*ssf state init/i);
    assert.ok(intake.indexOf('ssf state init') < intake.indexOf('ssf workflow show'));
  });

  it('requires recommendation and user selection before persisting an automatic workflow', () => {
    const skill = read('skills/workflow-start/SKILL.md');
    const classicIntake = skill.match(/### Workflow Path Intake[\s\S]*?(?=### Confirm DP-0)/)?.[0] ?? '';

    assert.deepEqual(
      protocolErrors(classicIntake).filter(error => !/DP-0 confirmation|confirmed state/.test(error)),
      [],
    );
    assert.match(skill, /needs-input/);
    assert.match(skill, /acknowledge-recommendation/);
    assert.doesNotMatch(skill, /No artifacts.*safe default to full/i);
  });

  it('rejects a protocol that persists selection before recommendation', () => {
    const wrongOrder = [
      'explicit workflow full hotfix tweak',
      'ssf workflow show',
      'only missing_facts',
      'ssf workflow select',
      'ssf workflow recommend',
      'Observed',
      'Available',
      'Recommended',
      'Why',
      "user's explicit path choice",
      'Confirm DP-0',
      'dp_0_confirmed true',
    ].join('\n');

    assert.ok(protocolErrors(wrongOrder).some((error) => error.includes('out of order')));
  });

  it('rejects a protocol that omits a required recommendation display field', () => {
    const missingWhy = [
      'explicit workflow full hotfix tweak',
      'ssf workflow show',
      'only missing_facts',
      'ssf workflow recommend',
      'Observed',
      'Available',
      'Recommended',
      "user's explicit path choice",
      'ssf workflow select',
      'Confirm DP-0',
      'dp_0_confirmed true',
    ].join('\n');

    assert.ok(protocolErrors(missingWhy).includes('missing Why'));
  });

  it('documents intake selection separately from DP-4 execution mode', () => {
    const decisions = read('docs/decision-points.md');

    assert.match(decisions, /full.*hotfix.*tweak/s);
    assert.match(decisions, /Inline.*Batch Inline.*SDD/s);
    assert.match(decisions, /\.superpowers\/sdd\/workflow-selection\.json/);
    assert.match(decisions, /\.spec-superflow\.yaml[^\n]*dp_0_[^\n]*(?:scope|artifact_language)/);
  });

  it('documents every DP-0 trigger including legacy recovery and fast paths', () => {
    const decisions = read('docs/decision-points.md');
    const trigger = decisions.match(/- \*\*触发条件\*\*：([^\n]+)/)?.[1] ?? '';

    assert.match(trigger, /auto/i);
    assert.match(trigger, /空|empty/i);
    assert.match(trigger, /legacy/i);
    assert.match(trigger, /fast path/i);
  });
});
