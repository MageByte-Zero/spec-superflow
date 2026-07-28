import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Validator } from '../../dist/index.js';
import * as publication from '../../scripts/lib/spec-publication.mjs';

function requirement(name, text = name) {
  return `### Requirement: ${name}\n\nThe system SHALL ${text}.\n\n#### Scenario: ${name}\n- **WHEN** publication runs\n- **THEN** ${text}.`;
}

function baseline(capability, blocks) {
  return `# ${capability}\n\n## Purpose\n\n${capability} keeps its published behavior clear for users.\n\n## Requirements\n\n${blocks.join('\n\n')}\n`;
}

function baselineWithoutPurpose(capability, blocks) {
  return `# ${capability}\n\n## Requirements\n\n${blocks.join('\n\n')}\n`;
}

function detailed(baselineContent, deltaContent, capability) {
  assert.equal(
    typeof publication.applyDeltaToBaselineDetailed,
    'function',
    'publication must expose the detailed result API without changing the legacy wrapper',
  );
  return publication.applyDeltaToBaselineDetailed(baselineContent, deltaContent, capability);
}

function assertOperation(result, operation, status) {
  assert.ok(Array.isArray(result.operations), 'detailed publication result exposes operation results');
  assert.ok(
    result.operations.some(entry => entry.operation === operation && entry.status === status),
    `expected ${operation} to be reported as ${status}`,
  );
}

describe('spec-publication: detailed, idempotent publication candidates', () => {
  it('creates a new canonical baseline that inherits an unfenced delta Purpose and passes main-spec validation', () => {
    const delta = `# Workflow delta\n\n## Purpose\n\nWorkflow publication preserves a human-authored explanation for maintainers.\n\n## ADDED Requirements\n\n${requirement('Publish purpose', 'retain the supplied purpose')}`;

    const result = detailed('', delta, 'workflow');

    assert.equal(result.changed, true);
    assert.match(result.content, /## Purpose\n\nWorkflow publication preserves a human-authored explanation for maintainers\./);
    assert.match(result.content, /## Requirements/);
    assert.equal(new Validator().validateSpecContent('workflow', result.content).valid, true);
  });

  it('uses a deterministic, capability-specific default Purpose when a new delta has none', () => {
    const delta = `## ADDED Requirements\n\n${requirement('Default purpose', 'receive a deterministic fallback')}`;

    const first = detailed('', delta, 'workflow');
    const second = detailed('', delta, 'workflow');

    const purpose = first.content.match(/## Purpose\n\n([^\n]+)/)?.[1];
    assert.ok(purpose, 'new baseline receives a non-empty Purpose');
    assert.match(purpose, /workflow/i, 'fallback is specific to the capability');
    assert.equal(first.content, second.content, 'fallback content is deterministic');
    assert.ok(Array.isArray(first.warnings), 'fallback is observable to callers');
    assert.ok(first.warnings.some(warning => /default.*purpose|purpose.*default/i.test(String(warning))));
    assert.equal(new Validator().validateSpecContent('workflow', first.content).valid, true);
  });

  it('preserves an existing no-Purpose baseline byte-for-byte when an equivalent delta is replayed', () => {
    const existing = baselineWithoutPurpose('workflow', [requirement('Already published', 'remain unchanged')]);
    const delta = `## ADDED Requirements\n\n${requirement('Already published', 'remain unchanged')}`;

    const result = detailed(existing, delta, 'workflow');

    assert.equal(result.changed, false, 'an existing no-Purpose baseline is not upgraded during a no-op replay');
    assert.equal(result.content, existing, 'a no-op replay preserves existing baseline bytes');
    assertOperation(result, 'ADDED', 'skipped');
    assert.deepEqual(result.warnings, [], 'no default Purpose warning is emitted for an existing baseline');
  });

  it('keeps applyDeltaToBaseline as the string-returning compatibility wrapper', () => {
    const delta = `## ADDED Requirements\n\n${requirement('Compatibility', 'keep the old public return type')}`;
    const result = detailed('', delta, 'workflow');
    const legacy = publication.applyDeltaToBaseline('', delta, 'workflow');

    assert.equal(typeof legacy, 'string');
    assert.equal(legacy, result.content);
  });

  it('reports each equivalent ADDED, MODIFIED, REMOVED, and RENAMED replay as a no-op, but re-applies when its state changes', () => {
    const cases = [
      {
        operation: 'ADDED',
        initial: baseline('workflow', []),
        delta: `## ADDED Requirements\n\n${requirement('Added', 'be newly added')}`,
        disturb: content => content.replace(/### Requirement: Added[\s\S]*$/, '').replace(/\n+$/, '\n'),
      },
      {
        operation: 'MODIFIED',
        initial: baseline('workflow', [requirement('Modified', 'use the old behavior')]),
        delta: `## MODIFIED Requirements\n\n${requirement('Modified', 'use the desired behavior')}`,
        disturb: content => content.replace('use the desired behavior', 'use a divergent behavior'),
      },
      {
        operation: 'REMOVED',
        initial: baseline('workflow', [requirement('Removed', 'be removed')]),
        delta: '## REMOVED Requirements\n\n### Requirement: Removed',
        disturb: content => `${content.trimEnd()}\n\n${requirement('Removed', 'be restored after replay')}\n`,
      },
      {
        operation: 'RENAMED',
        initial: baseline('workflow', [requirement('Before rename', 'be renamed')]),
        delta: '## RENAMED Requirements\n\n- FROM: `### Requirement: Before rename`\n- TO: `### Requirement: After rename`',
        disturb: content => content.replaceAll('After rename', 'Before rename'),
      },
    ];

    for (const testCase of cases) {
      const first = detailed(testCase.initial, testCase.delta, 'workflow');
      assert.equal(first.changed, true, `${testCase.operation} initially changes the published candidate`);
      assertOperation(first, testCase.operation, 'applied');

      const replay = detailed(first.content, testCase.delta, 'workflow');
      assert.equal(replay.changed, false, `${testCase.operation} replay does not rewrite an equivalent candidate`);
      assert.equal(replay.content, first.content, `${testCase.operation} replay preserves content byte-for-byte`);
      assertOperation(replay, testCase.operation, 'skipped');

      const reactivated = detailed(testCase.disturb(replay.content), testCase.delta, 'workflow');
      assert.equal(
        reactivated.changed,
        true,
        `${testCase.operation} no-op becomes observable again if the relevant published state changes`,
      );
    }
  });

  it('rejects case, whitespace, and punctuation near-matches instead of silently treating them as no-ops', () => {
    const nearMatches = [
      { actual: 'Billing Rules', requested: 'billing   rules' },
      { actual: 'Deploy-Policy', requested: 'Deploy Policy' },
    ];

    for (const { actual, requested } of nearMatches) {
      const existing = baseline('workflow', [requirement(actual, 'remain published until explicitly removed')]);
      const delta = `## REMOVED Requirements\n\n### Requirement: ${requested}`;

      assert.throws(
        () => detailed(existing, delta, 'workflow'),
        new RegExp(`${requested.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*${actual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${actual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*${requested.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        'a near name must be diagnosed with both the requested and existing names',
      );
    }
  });

  it('refuses an invalid delta instead of returning a candidate that could be published', () => {
    const invalidDelta = '## ADDED Requirements\n\n### Notes: this is not a requirement\n\nNo requirement is declared here.';

    assert.throws(
      () => detailed('', invalidDelta, 'workflow'),
      /invalid delta|no deltas found|requirement/i,
    );
  });
});
