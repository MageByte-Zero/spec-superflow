import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function read(path) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('SSF recovery command assets', () => {
  for (const name of ['resume', 'switch', 'save']) {
    it(`${name} uses the portable ssf command without hidden state writes`, () => {
      const content = read(`commands/ssf/${name}.md`);

      assert.match(content, /^---\n[\s\S]+description:/);
      assert.match(content, /argument-hint:/);
      assert.match(content, new RegExp(`spec-superflow@0\\.10\\.0 ssf ${name}`));
      assert.match(content, /\$ARGUMENTS/);
      assert.doesNotMatch(content, /state set|state transition|active-change|\bcd\s/);
    });
  }

  it('routes resume blockers through workflow-start without changing state directly', () => {
    const content = read('commands/ssf/resume.md');

    assert.match(content, /change.*blockers.*next_action/s);
    assert.match(content, /存在 blocker 时停止/);
    assert.match(content, /workflow-start/);
  });

  it('requires an explicit switch target and limits switching to conversation focus', () => {
    const content = read('commands/ssf/switch.md');

    assert.match(content, /\$ARGUMENTS.*非空/s);
    assert.match(content, /当前对话.*关注对象/);
  });

  it('asks once for incomplete save input and never invents checkpoint evidence', () => {
    const content = read('commands/ssf/save.md');

    assert.match(content, /change、`--task` 和 `--next`/);
    assert.match(content, /信息不足时先询问一次/);
    assert.match(content, /不要编造 verification 或 review 证据/);
  });

  it('never expands raw arguments as shell command input', () => {
    for (const name of ['resume', 'switch', 'save']) {
      const content = read(`commands/ssf/${name}.md`);

      assert.doesNotMatch(content, new RegExp(`ssf ${name} \\$ARGUMENTS(?:\\s|\\x60)`));
    }
  });

  it('passes resume and switch targets as one quoted literal after validation', () => {
    for (const name of ['resume', 'switch']) {
      const content = read(`commands/ssf/${name}.md`);

      assert.match(content, new RegExp(`ssf ${name} --json "\\$ARGUMENTS"`));
      assert.match(content, /非空/);
    }
  });

  it('extracts save fields and quotes each explicit CLI argument', () => {
    const content = read('commands/ssf/save.md');

    assert.match(content, /提取.*change.*task.*next/s);
    assert.match(content, /ssf save "<change>" --task "<task-id>" --next "<next-step>".*--json/);
    assert.doesNotMatch(content, /ssf save \$ARGUMENTS/);
  });
});
