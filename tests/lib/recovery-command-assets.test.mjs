import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHECKOUT_ABSOLUTE_PATHS = [
  /(?:^|[\s"'`(])\/Users\/[^\s"'`)]*/gm,
  /(?:^|[\s"'`(])\/home\/[^\s"'`)]*/gm,
  /(?:^|[\s"'`(])\/(?:workspace|workspaces)\/[^\s"'`)]*/gm,
  /(?:^|[\s"'`(])\/(?:private\/)?tmp\/[^\s"'`)]*/gm,
  /(?:^|[\s"'`(])\/(?:[^\s"'`)]*\/)*scripts\/spec-superflow\.mjs\b/gm,
  /(?:^|[\s"'`(])[A-Za-z]:\\[^\s"'`)]*\\scripts\\spec-superflow\.mjs\b/gm,
];

function read(path) {
  // Normalize CRLF so line-oriented assertions behave identically on Windows
  // checkouts (where git autocrlf may convert the committed LF to CRLF).
  return readFileSync(join(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');
}

const VERSION = JSON.parse(read('package.json')).version;
const BUNDLED_RUNTIME = 'SSF';
const BUNDLED_RUNTIME_DEFINITION = 'node "<plugin-root>/scripts/spec-superflow.mjs"';

function executableSsfCommands(content) {
  return [...content.matchAll(/`([^`\n]*\bSSF\s+(?:resume|switch|save)\b[^`]*)`/g)]
    .map(match => match[1]);
}

function assertNoCheckoutAbsolutePaths(content) {
  const withoutPortableRuntime = content.replaceAll('<plugin-root>/scripts/spec-superflow.mjs', '<bundled-runtime>');
  for (const pattern of CHECKOUT_ABSOLUTE_PATHS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(withoutPortableRuntime);
    assert.equal(
      match,
      null,
      `checkout-specific absolute path in command asset: ${match?.[0].trim()}`,
    );
  }
}

function assertNoUnquotedArguments(content) {
  for (const command of executableSsfCommands(content)) {
    let quote = null;
    for (let index = 0; index < command.length; index += 1) {
      const character = command[index];
      if (character === '"' || character === "'") {
        quote = quote === character ? null : quote ?? character;
        continue;
      }
      if (quote === null && command.startsWith('$ARGUMENTS', index)) {
        assert.fail(`unquoted $ARGUMENTS in executable command: ${command}`);
      }
    }
  }
}

describe('SSF recovery command assets', () => {
  for (const name of ['resume', 'switch', 'save']) {
    it(`${name} uses the bundled CLI without hidden state writes`, () => {
      const content = read(`commands/ssf/${name}.md`);

      assert.match(content, /^---\n[\s\S]+description:/);
      assert.match(content, /argument-hint:/);
      assert.match(content, /allowed-tools: Bash\(node:\*\)/);
      assert.ok(content.includes(BUNDLED_RUNTIME_DEFINITION));
      assert.match(content, new RegExp(`${BUNDLED_RUNTIME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${name}\\b`));
      assert.match(content, /\$ARGUMENTS/);
      assert.doesNotMatch(content, /state set|state transition|active-change|\bcd\s/);
      assertNoCheckoutAbsolutePaths(content);
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

    assert.match(content, /提取明确的 change、task 和 next/);
    assert.match(content, /信息不足时先询问一次/);
    assert.match(content, /不要编造 verification 或 review 证据/);
  });

  it('never expands raw arguments as shell command input', () => {
    for (const name of ['resume', 'switch', 'save']) {
      assertNoUnquotedArguments(read(`commands/ssf/${name}.md`));
    }
  });

  it('rejects unquoted raw arguments after executable command flags', () => {
    const unsafeResume = `Run \`${BUNDLED_RUNTIME} resume --json $ARGUMENTS\`.`;
    const unsafeSwitch = `Run \`${BUNDLED_RUNTIME} switch --flag $ARGUMENTS\`.`;

    assert.throws(() => assertNoUnquotedArguments(unsafeResume), /\$ARGUMENTS/);
    assert.throws(() => assertNoUnquotedArguments(unsafeSwitch), /\$ARGUMENTS/);
  });

  it('accepts quoted argument input and prose-only argument mentions', () => {
    const safeResume = `Run \`${BUNDLED_RUNTIME} resume --json "$ARGUMENTS"\`. $ARGUMENTS is conversational input.`;

    assert.doesNotThrow(() => assertNoUnquotedArguments(safeResume));
    assert.doesNotThrow(() => assertNoUnquotedArguments(read('commands/ssf/save.md')));
  });

  it('rejects checkout-specific absolute paths anywhere in a command asset', () => {
    const unsafeAssets = [
      'Run `node /Users/alice/src/spec-superflow/scripts/spec-superflow.mjs resume`.',
      'Run `node /home/alice/src/spec-superflow/scripts/spec-superflow.mjs switch`.',
      'Run `/workspace/spec-superflow/scripts/spec-superflow.mjs save`.',
      'Run `node /tmp/ssf-checkout/scripts/spec-superflow.mjs resume`.',
      'Run `node /opt/build/spec-superflow/scripts/spec-superflow.mjs resume`.',
    ];

    for (const content of unsafeAssets) {
      assert.throws(
        () => assertNoCheckoutAbsolutePaths(content),
        /checkout-specific absolute path/,
      );
    }
  });

  it('does not mistake the bundled runtime placeholder for a checkout path', () => {
    const portable = `Run \`${BUNDLED_RUNTIME} resume --json "$ARGUMENTS"\`.`;

    assert.doesNotThrow(() => assertNoCheckoutAbsolutePaths(portable));
  });

  it('passes resume and switch targets as one quoted literal after validation', () => {
    for (const name of ['resume', 'switch']) {
      const content = read(`commands/ssf/${name}.md`);

      assert.match(content, new RegExp(`${BUNDLED_RUNTIME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${name} --json "\\$ARGUMENTS"`));
      assert.match(content, /非空/);
    }
  });

  it('extracts save fields and quotes each explicit CLI argument', () => {
    const content = read('commands/ssf/save.md');

    assert.match(content, /提取.*change.*task.*next/s);
    assert.match(content, new RegExp(`${BUNDLED_RUNTIME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} save "<change>" --task "<task-id>" --next "<next-step>".*--json`));
    assert.doesNotMatch(content, /spec-superflow\.mjs" save \$ARGUMENTS/);
  });
});
