import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/hol-plugin-scanner.yml', 'utf8');

describe('plugin scanner observability', () => {
  it('publishes actionable findings without weakening the high-severity gate', () => {
    assert.match(workflow, /fail_on_severity: high/);
    assert.match(workflow, /format: json/);
    assert.match(workflow, /output: plugin-scanner-report\.json/);
    assert.match(workflow, /pr_comment: always/);
    assert.match(workflow, /pr_comment_style: detailed/);
    assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
    assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
    assert.match(workflow, /name: plugin-scanner-report/);
    assert.match(workflow, /path: plugin-scanner-report\.json/);
  });
});
