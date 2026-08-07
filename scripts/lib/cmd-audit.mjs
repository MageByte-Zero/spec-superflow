// scripts/lib/cmd-audit.mjs — ssf audit: generate decision-point audit report
import { existsSync } from 'node:fs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { readState } from './state-loader.mjs';
import { inspectDebugEscalation } from './debug-attempts.mjs';

const DP_NAMES = {
  0: '用户确认门禁',
  1: '需求确认',
  2: '工件审查',
  3: '契约批准',
  4: '执行模式选择',
  5: '调试升级',
  6: '验证失败',
  7: '归档确认',
};

function formatResult(result) {
  if (result === null || result === undefined || result === '') return 'not recorded';
  return String(result);
}

function formatTimestamp(ts) {
  if (ts === null || ts === undefined || ts === '') return '—';
  return String(ts);
}

function isConfirmed(value) {
  return value === true || value === 'true';
}

function formatDpResult(state, dp) {
  const result = formatResult(state[`dp_${dp}_result`]);
  if (dp === 0 && result === 'not recorded' && isConfirmed(state.dp_0_confirmed)) {
    return 'confirmed';
  }
  return result;
}

function generateReport(changeDir, state) {
  const debugEscalation = inspectDebugEscalation(changeDir, state);
  const rows = [];
  for (let i = 0; i <= 7; i++) {
    const recordedResult = formatDpResult(state, i);
    const unsupportedDebugRecord = i === 5
      && recordedResult !== 'not recorded'
      && !debugEscalation.supported;
    const result = unsupportedDebugRecord ? `unsupported: ${recordedResult}` : recordedResult;
    const timestamp = formatTimestamp(state[`dp_${i}_timestamp`]);
    rows.push({
      dp: i,
      name: DP_NAMES[i],
      result,
      timestamp,
      recorded: recordedResult !== 'not recorded' && !unsupportedDebugRecord,
      unsupportedReason: unsupportedDebugRecord ? debugEscalation.reason : null,
    });
  }

  const recordedCount = rows.filter(r => r.recorded).length;
  const missingCount = rows.length - recordedCount;

  let md = `# Decision-Point Audit Report\n\n`;
  md += `**变更**: ${state.change_name || basename(changeDir)}  \n`;
  md += `**生成时间**: ${new Date().toISOString()}  \n`;
  md += `**当前状态**: ${state.state || 'unknown'}  \n\n`;

  md += `## 汇总表\n\n`;
  md += `| DP | 名称 | 结果 | 时间戳 |\n`;
  md += `|----|------|------|--------|\n`;
  for (const r of rows) {
    md += `| DP-${r.dp} | ${r.name} | ${r.result} | ${r.timestamp} |\n`;
  }

  md += `\n**统计**: ${recordedCount}/8 已记录，${missingCount}/8 未记录。\n\n`;

  md += `## 逐决策点说明\n\n`;
  for (const r of rows) {
    md += `### DP-${r.dp}: ${r.name}\n\n`;
    md += `- **结果**: ${r.result}\n`;
    md += `- **时间戳**: ${r.timestamp}\n`;
    if (r.unsupportedReason) {
      md += `- **解读**: DP-5 unsupported — ${r.unsupportedReason}.\n`;
    } else if (r.result === 'not recorded') {
      md += '- **解读**: 该决策点尚未记录结果。如果工作流已经经过该阶段，请检查是否漏记。\n';
    } else {
      md += `- **解读**: 决策点 DP-${r.dp} 已记录为 "${r.result}"。\n`;
    }
    md += '\n';
  }

  md += `---\n\n`;
  md += `*本报告由 \`ssf audit\` 自动生成，仅供审计与归档参考。*\n`;

  return md;
}

function basename(p) {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

export { generateReport, DP_NAMES };

export async function run(args) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      output: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const changeDir = positionals[0];
  if (!changeDir) {
    console.error('Usage: ssf audit <change-dir> [--output <file>] [--json]');
    process.exit(2);
  }

  const stateFile = join(changeDir, '.spec-superflow.yaml');
  if (!existsSync(stateFile)) {
    console.error(`No .spec-superflow.yaml found in ${changeDir}`);
    process.exit(1);
  }

  const state = readState(changeDir);
  const report = generateReport(changeDir, state);
  const outputPath = values.output || join(changeDir, 'decision-point-audit.md');

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, report, 'utf-8');

  if (values.json) {
    console.log(JSON.stringify({ ok: true, output: outputPath, change_name: state.change_name, state: state.state }));
  } else {
    console.log(`✅ Audit report written to ${outputPath}`);
    console.log(`   Change: ${state.change_name} | State: ${state.state}`);
  }
}
