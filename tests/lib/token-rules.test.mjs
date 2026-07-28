// tests/lib/token-rules.test.mjs
// Tests for scripts/lint/rules/token-rules.mjs — lint rule functions

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkMaxLines, checkMaxChars, checkMaxEmphasisMarkers, checkMaxCodeBlockLength } from '../../scripts/lint/rules/token-rules.mjs';

const CTX = { skillDirs: ['test-skill'], skillsDir: '/fake/skills' };
const ROOT = process.cwd();
const read = file => readFileSync(join(ROOT, file), 'utf8');

describe('token-rules: checkMaxLines', () => {
  it('passes when under limit', async () => {
    const issues = await checkMaxLines('test', 'line1\nline2\nline3', CTX, 10);
    assert.equal(issues.length, 0);
  });

  it('fails when over limit', async () => {
    const content = Array(251).fill('line').join('\n');
    const issues = await checkMaxLines('test', content, CTX, 250);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, 'error');
    assert.ok(issues[0].message.includes('251'));
  });
});

describe('token-rules: checkMaxChars', () => {
  it('passes when under limit', async () => {
    const issues = await checkMaxChars('test', 'short', CTX, 100);
    assert.equal(issues.length, 0);
  });

  it('warns when over limit', async () => {
    const content = 'x'.repeat(10001);
    const issues = await checkMaxChars('test', content, CTX, 10000);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, 'warning');
  });
});

describe('token-rules: checkMaxEmphasisMarkers', () => {
  it('passes for content without banned markers', async () => {
    const issues = await checkMaxEmphasisMarkers('test', 'normal text with **some** emphasis', CTX, 30);
    assert.equal(issues.length, 0);
  });

  it('detects EXTREMELY_IMPORTANT', async () => {
    const issues = await checkMaxEmphasisMarkers('test', 'This is EXTREMELY_IMPORTANT content', CTX, 30);
    const eiIssue = issues.find(i => i.message.includes('EXTREMELY_IMPORTANT'));
    assert.ok(eiIssue, 'should flag EXTREMELY_IMPORTANT');
    assert.equal(eiIssue.severity, 'error');
  });

  it('detects CRITICAL', async () => {
    const issues = await checkMaxEmphasisMarkers('test', 'CRITICAL: do not skip', CTX, 30);
    const crIssue = issues.find(i => i.message.includes('CRITICAL'));
    assert.ok(crIssue, 'should flag CRITICAL');
    assert.equal(crIssue.severity, 'error');
  });

  it('warns on too many IMPORTANT occurrences', async () => {
    const content = 'IMPORTANT\n'.repeat(5) + 'text';
    const issues = await checkMaxEmphasisMarkers('test', content, CTX, 30);
    const impIssue = issues.find(i => i.message.includes('IMPORTANT'));
    assert.ok(impIssue, 'should flag excessive IMPORTANT');
  });

  it('warns on too many emphasis markers', async () => {
    const content = '**a** **b** '.repeat(31);
    const issues = await checkMaxEmphasisMarkers('test', content, CTX, 30);
    const empIssue = issues.find(i => i.message.includes('emphasis markers'));
    assert.ok(empIssue, 'should flag excessive emphasis');
    assert.equal(empIssue.severity, 'warning');
  });
});

describe('token-rules: checkMaxCodeBlockLength', () => {
  it('passes for short code blocks', async () => {
    const issues = await checkMaxCodeBlockLength('test', '```\nline1\nline2\n```', CTX, 5);
    assert.equal(issues.length, 0);
  });

  it('warns for long code blocks', async () => {
    const lines = Array(17).fill('code').join('\n');
    const content = '```\n' + lines + '\n```';
    const issues = await checkMaxCodeBlockLength('test', content, CTX, 15);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, 'warning');
    assert.ok(issues[0].message.includes('19'), `expected message to include '19', got: ${issues[0].message}`);
  });

  it('handles content with no code blocks', async () => {
    const issues = await checkMaxCodeBlockLength('test', 'just text, no code', CTX, 15);
    assert.equal(issues.length, 0);
  });
});

describe('spec publication documentation contract', () => {
  it('keeps Purpose optional for delta specs while documenting deterministic publication behavior', () => {
    const template = read('templates/spec.md');
    const merger = read('skills/spec-merger/SKILL.md');
    const artifactContract = read('docs/artifact-contract.md');

    assert.match(template, /## Purpose[\s\S]*可选/,
      'the delta template must present Purpose as an optional extension');
    assert.match(template, /可省略/,
      'legacy delta specs must remain valid without a Purpose section');
    assert.match(merger, /only when creating a canonical main spec/i,
      'Purpose handling must be limited to new main specs');
    assert.match(merger, /deterministic default Purpose/i,
      'missing Purpose must have an explicit deterministic fallback');
    assert.match(merger, /must not overwrite an existing main spec Purpose/i,
      'a delta Purpose must not rewrite an existing main spec');
    assert.match(artifactContract, /no-op.*already synchronized/i,
      'the artifact contract must identify an already-synchronized delta as a no-op');
    assert.match(artifactContract, /near-match.*must fail/i,
      'the artifact contract must keep near-match mistakes outside no-op handling');
  });
});
