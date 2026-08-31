// tests/lib/infer-workflow.test.mjs
// Tests for scripts/infer-workflow.mjs — mode inference logic
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

let tempDir;

describe('infer-workflow: inferMode()', () => {
  let inferMode;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ssf-infer-'));
    const modulePath = join(process.cwd(), 'scripts/infer-workflow.mjs');
    const mod = await import(pathToFileURL(modulePath).href);
    inferMode = mod.inferMode;
  });

  after(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('keeps the legacy artifact inference safe default for compatibility', () => {
    const result = inferMode(tempDir);
    assert.equal(result.mode, 'full');
    assert.equal(result.explicit, false);
  });

  it('preserves explicit hotfix override', () => {
    writeFileSync(join(tempDir, '.spec-superflow.yaml'), 'state: executing\nworkflow: hotfix');
    const result = inferMode(tempDir);
    assert.equal(result.mode, 'hotfix');
    assert.equal(result.explicit, true);
  });

  it('preserves explicit tweak override', () => {
    writeFileSync(join(tempDir, '.spec-superflow.yaml'), 'state: executing\nworkflow: tweak');
    const result = inferMode(tempDir);
    assert.equal(result.mode, 'tweak');
    assert.equal(result.explicit, true);
  });

  it('infers tweak for a small documentation change', () => {
    // Use consistent paths — same file names in proposal AND tasks to avoid unique-count inflation
    writeFileSync(join(tempDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    writeFileSync(join(tempDir, 'proposal.md'), '# Proposal\nFix typo in README.md');
    writeFileSync(join(tempDir, 'tasks.md'), '- [ ] Fix typo in README.md\n- [ ] Verify fix');

    const result = inferMode(tempDir);
    assert.equal(result.mode, 'tweak', `Expected tweak but got ${result.mode}: ${result.reason}`);
  });

  it('infers quick for small code change (≤2 tasks, ≤2 files, no schema)', () => {
    writeFileSync(join(tempDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    writeFileSync(join(tempDir, 'proposal.md'), '# Proposal\nFix null check in util.ts');
    writeFileSync(join(tempDir, 'tasks.md'), '- [ ] Add null check in util.ts\n- [ ] Add test for null case');

    const result = inferMode(tempDir);
    assert.equal(result.mode, 'quick', `Expected quick but got ${result.mode}: ${result.reason}`);
  });

  it('infers quick for a bounded three-file code change', () => {
    writeFileSync(join(tempDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    writeFileSync(join(tempDir, 'proposal.md'), '# Change\nModify src/a.ts src/b.ts src/c.ts');
    writeFileSync(join(tempDir, 'tasks.md'), '- [ ] Update src/a.ts\n- [ ] Update src/b.ts\n- [ ] Verify src/c.ts');

    const result = inferMode(tempDir);
    assert.equal(result.mode, 'quick');
  });

  it('infers quick for small Java code changes', () => {
    const changeDir = mkdtempSync(join(tempDir, 'java-hotfix-'));
    writeFileSync(join(changeDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    writeFileSync(join(changeDir, 'proposal.md'), '# Proposal\nFix null check in src/Main.java');
    writeFileSync(join(changeDir, 'tasks.md'), '- [ ] Fix null check in src/Main.java\n- [ ] Add regression test');

    const result = inferMode(changeDir);

    assert.equal(result.mode, 'quick', `Expected quick but got ${result.mode}: ${result.reason}`);
  });

  it('infers quick for bounded multi-task Java and Go code changes', () => {
    const javaDir = mkdtempSync(join(tempDir, 'java-code-'));
    writeFileSync(join(javaDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    writeFileSync(join(javaDir, 'proposal.md'), '# Proposal\nRefactor service in src/Main.java');
    writeFileSync(join(javaDir, 'tasks.md'), '- [ ] Update service in src/Main.java\n- [ ] Add unit test\n- [ ] Update integration test');

    const goDir = mkdtempSync(join(tempDir, 'go-code-'));
    writeFileSync(join(goDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    writeFileSync(join(goDir, 'proposal.md'), '# Proposal\nRefactor handler in cmd/server/main.go');
    writeFileSync(join(goDir, 'tasks.md'), '- [ ] Update handler in cmd/server/main.go\n- [ ] Add unit test\n- [ ] Update wiring');

    assert.equal(inferMode(javaDir).mode, 'quick');
    assert.equal(inferMode(goDir).mode, 'quick');
  });

  it('infers quick for bounded multi-task Python and Rust code changes', () => {
    const pythonDir = mkdtempSync(join(tempDir, 'python-code-'));
    writeFileSync(join(pythonDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    writeFileSync(join(pythonDir, 'proposal.md'), '# Proposal\nRefactor worker in app/worker.py');
    writeFileSync(join(pythonDir, 'tasks.md'), '- [ ] Update worker in app/worker.py\n- [ ] Add unit test\n- [ ] Update scheduler');

    const rustDir = mkdtempSync(join(tempDir, 'rust-code-'));
    writeFileSync(join(rustDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    writeFileSync(join(rustDir, 'proposal.md'), '# Proposal\nRefactor parser in src/parser.rs');
    writeFileSync(join(rustDir, 'tasks.md'), '- [ ] Update parser in src/parser.rs\n- [ ] Add unit test\n- [ ] Update caller');

    assert.equal(inferMode(pythonDir).mode, 'quick');
    assert.equal(inferMode(rustDir).mode, 'quick');
  });

  it('infers tweak for config/doc-only change (≤4 tasks)', () => {
    writeFileSync(join(tempDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    writeFileSync(join(tempDir, 'proposal.md'), '# Proposal\nUpdate README.md');
    writeFileSync(join(tempDir, 'tasks.md'), '- [ ] Update README.md\n- [ ] Update CHANGELOG.md\n- [ ] Update version in package.json');

    const result = inferMode(tempDir);
    // 3 tasks, only doc/config files → tweak
    assert.equal(result.mode, 'tweak', `Expected tweak but got ${result.mode}: ${result.reason}`);
  });

  it('infers full when schema keyword detected', () => {
    writeFileSync(join(tempDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    writeFileSync(join(tempDir, 'proposal.md'), '# Proposal\nChange the API interface for src/auth.ts');
    writeFileSync(join(tempDir, 'tasks.md'), '- [ ] Update API\n- [ ] Update tests');

    const result = inferMode(tempDir);
    assert.equal(result.mode, 'full');
    assert.ok(result.reason.includes('schema/API'));
  });

  it('infers full when new module keyword detected', () => {
    writeFileSync(join(tempDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    writeFileSync(join(tempDir, 'proposal.md'), '# Proposal\nAdd 新增模块 for payment processing');
    writeFileSync(join(tempDir, 'tasks.md'), '- [ ] Create new module');

    const result = inferMode(tempDir);
    assert.equal(result.mode, 'full');
    assert.ok(result.reason.includes('new module'));
  });

  it('infers full when too many files (> 3) for quick', () => {
    writeFileSync(join(tempDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    writeFileSync(join(tempDir, 'proposal.md'), '# Big change\nModify src/a.ts src/b.ts src/c.ts src/d.ts');
    writeFileSync(join(tempDir, 'tasks.md'), '- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3\n- [ ] Task 4');

    const result = inferMode(tempDir);
    assert.equal(result.mode, 'full');
  });

  it('infers full when too many tasks (> 2) for hotfix (but not tweak due to code files)', () => {
    writeFileSync(join(tempDir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    writeFileSync(join(tempDir, 'proposal.md'), '# Change\nModify src/a.ts');
    writeFileSync(join(tempDir, 'tasks.md'), '- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3\n- [ ] Task 4\n- [ ] Task 5');

    const result = inferMode(tempDir);
    assert.equal(result.mode, 'full');
  });

  it('counts numbered-heading tasks (### N.) as tasks instead of no-artifacts', () => {
    const dir = mkdtempSync(join(tempDir, 'heading-only-'));
    writeFileSync(join(dir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    // No filename references anywhere → fileCount=0. Old behavior (headings not
    // counted) hit "no planning artifacts → full"; new behavior counts 2 tasks
    // and routes to tweak — the assertion below distinguishes the two.
    writeFileSync(join(dir, 'proposal.md'), '# Proposal\n更新计划说明文档与相关注释');
    writeFileSync(join(dir, 'tasks.md'), '### 1. 任务一\n### 2. 任务二');

    const result = inferMode(dir);
    assert.notEqual(result.reason.includes('no planning artifacts'), true,
      `Expected numbered headings to count as tasks but got: ${result.reason}`);
    assert.equal(result.mode, 'tweak', `Expected tweak but got ${result.mode}: ${result.reason}`);
  });

  it('counts mixed checkbox and numbered-heading tasks without double counting', () => {
    const dir = mkdtempSync(join(tempDir, 'mixed-format-'));
    writeFileSync(join(dir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    writeFileSync(join(dir, 'proposal.md'), '# Proposal\nModify src/a.ts src/b.ts src/c.ts');
    writeFileSync(join(dir, 'tasks.md'),
      '- [ ] Update src/a.ts\n- [ ] Update src/b.ts\n- [ ] Update src/c.ts\n### 4. 验证与收尾\n### 5. 补充回归');

    const result = inferMode(dir);
    // 5 tasks total → too many for quick(≤3) → full
    assert.equal(result.mode, 'full', `Expected full (5 mixed tasks) but got ${result.mode}: ${result.reason}`);
    assert.ok(result.reason.startsWith('5 tasks'),
      `Expected taskCount=5 in reason but got: ${result.reason}`);
  });

  it('does not count plain headings without numeric prefix as tasks', () => {
    const dir = mkdtempSync(join(tempDir, 'plain-heading-'));
    writeFileSync(join(dir, '.spec-superflow.yaml'), 'state: exploring\nworkflow: auto');
    writeFileSync(join(dir, 'proposal.md'), '# Proposal\nModify src/a.ts');
    writeFileSync(join(dir, 'tasks.md'), '### 设计说明\n### 注意事项\n- [ ] Fix null check in src/a.ts');

    const result = inferMode(dir);
    // Only the checkbox line counts (1 task, ≤3 files) → quick; plain headings add nothing
    assert.equal(result.mode, 'quick', `Expected quick (plain headings ignored) but got ${result.mode}: ${result.reason}`);
    assert.equal(result.reason.includes('6 tasks'), false,
      `Plain headings should not inflate task count: ${result.reason}`);
  });

  it('returns reason string for all modes', () => {
    const result = inferMode(tempDir);
    assert.ok(typeof result.reason === 'string');
    assert.ok(result.reason.length > 0);
  });
});
