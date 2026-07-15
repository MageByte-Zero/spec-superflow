// tests/lib/cmd-install-zcode.test.mjs
// Regression for #29: `ssf install-zcode` deploys skills to .zcode/ with the
// CLAUDE_PLUGIN_ROOT placeholder rewritten to an absolute path.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CLI = join(ROOT, 'scripts', 'spec-superflow.mjs');

describe('BUG/#29: install-zcode deploys skills', () => {
  let cwd;
  before(() => { cwd = mkdtempSync(join(tmpdir(), 'ssf-zcode-install-')); });
  after(() => { if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true }); });

  it('SHALL deploy skills to .zcode/skills/ with CLAUDE_PLUGIN_ROOT rewritten', () => {
    execSync(`node ${CLI} install-zcode --local "${ROOT}"`, { cwd, stdio: 'pipe', timeout: 60000 });
    const skillsDir = join(cwd, '.zcode', 'skills');
    assert.equal(existsSync(skillsDir), true, '.zcode/skills should exist');
    const wfStart = join(skillsDir, 'workflow-start', 'SKILL.md');
    assert.equal(existsSync(wfStart), true, 'workflow-start skill should be deployed');
    const content = readFileSync(wfStart, 'utf-8');
    assert.equal(content.includes('${CLAUDE_PLUGIN_ROOT}'), false, 'CLAUDE_PLUGIN_ROOT should be rewritten to an absolute path');
    assert.equal(existsSync(join(cwd, '.zcode', 'rules', 'phase-guard.mdc')), true, 'phase guard should be written');
  });

  it('SHALL give contract-builder the portable execution-contract asset command', () => {
    execSync(`node ${CLI} install-zcode --local "${ROOT}"`, { cwd, stdio: 'pipe', timeout: 60000 });

    const templatePath = join(cwd, '.zcode', 'spec-superflow', 'templates', 'execution-contract.md');
    const contractBuilder = readFileSync(join(cwd, '.zcode', 'skills', 'contract-builder', 'SKILL.md'), 'utf-8');

    assert.equal(existsSync(templatePath), true, 'deployed template should exist');
    assert.match(contractBuilder, /runtime asset read templates\/execution-contract\.md/);
  });
});
