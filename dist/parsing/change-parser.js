function normalizeLineEndings(content) {
    return content.replace(/\r\n?/g, '\n');
}
function extractSection(content, heading) {
    const normalized = normalizeLineEndings(content);
    const lines = normalized.split('\n');
    // Match headings that contain the English keyword — supports both
    // "## Why" and "## 背景（Why）" style bilingual headings.
    const headingRegex = new RegExp(`^##\\s+.*\\b${heading.replace(/\s+/g, '\\s+')}\\b.*$`, 'i');
    const idx = lines.findIndex((l) => headingRegex.test(l));
    if (idx === -1)
        return '';
    let endIdx = lines.length;
    for (let i = idx + 1; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i])) {
            endIdx = i;
            break;
        }
    }
    return lines.slice(idx + 1, endIdx).join('\n').trim();
}
export function parseChangeMarkdown(content, changeName) {
    const why = extractSection(content, 'Why');
    const whatChanges = extractSection(content, 'What Changes');
    const deltas = [];
    const deltaSectionRegex = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/im;
    const sections = content.split(/(?=^##\s)/m);
    for (const section of sections) {
        const match = section.match(deltaSectionRegex);
        if (match) {
            const operation = match[1].toUpperCase();
            const body = section.substring(match[0].length).trim();
            const descLines = [];
            for (const line of body.split('\n')) {
                if (/^###\s+/.test(line))
                    break;
                const trimmed = line.trim();
                if (trimmed)
                    descLines.push(trimmed);
            }
            deltas.push({
                spec: '',
                operation,
                description: descLines.join('\n'),
            });
        }
    }
    return {
        name: changeName,
        why,
        whatChanges,
        deltas,
    };
}
