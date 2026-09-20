// One parser for template task IDs, progress, checkpoints and task counts.
export function parseTasks(content) {
  return content.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^[ \t]*- \[([^\]]*)\](?:[ \t]+(.*))?$/);
    if (!match) return [];
    const text = match[2] ?? '';
    const id = text.replace(/^\*\*/, '').match(/^(\d+(?:\.\d+)*)(?=\s|\*\*|$)/)?.[1] ?? null;
    return [{ id, text, line, index, complete: /^[xX]$/.test(match[1]), marker: match[1] }];
  });
}

export function normalizeTaskCheckboxes(content) {
  // Preserve source bytes and old hash behavior except for valid indented tasks.
  return content.replace(/^([ \t]*- \[)[xX](\] .+)(\r?)$/gm, '$1 $2$3');
}
