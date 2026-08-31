// scripts/guard/checks/tasks-checkbox-format.mjs — verify tasks.md uses template checkbox format
import fs from 'node:fs';
import path from 'node:path';

/**
 * Check that tasks.md contains at least one checkbox task line (- [ ] or - [x]).
 * Returns { pass, failures[] }.
 */
export function checkTasksCheckboxFormat(changeDir) {
  const TEMPLATE_HINT = 'tasks.md 需使用模板 checkbox 格式（- [ ] 任务）';
  const tasksPath = path.join(changeDir, 'tasks.md');
  if (!fs.existsSync(tasksPath)) {
    return { pass: false, failures: [`tasks.md: missing; ${TEMPLATE_HINT}`] };
  }

  const content = fs.readFileSync(tasksPath, 'utf-8');
  const checkboxLines = content.match(/^[ \t]*- \[[ xX]\]/gm);
  if (!checkboxLines || checkboxLines.length === 0) {
    return { pass: false, failures: [`${TEMPLATE_HINT}: no checkbox task lines found`] };
  }

  return { pass: true, failures: [] };
}
