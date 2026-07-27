export interface RequirementBlock {
  headerLine: string;
  name: string;
  raw: string;
}

export interface RequirementsSectionParts {
  before: string;
  headerLine: string;
  preamble: string;
  bodyBlocks: RequirementBlock[];
  after: string;
}

export function normalizeRequirementName(name: string): string {
  return name.trim();
}

// Keep the canonical `Requirement:` form while accepting existing Chinese
// artifacts that use a stable requirement ID as the heading.
export const REQUIREMENT_HEADER_REGEX = /^###\s*(?:(?:Requirement|需求)\s*[:：]\s*(.+)|(REQ-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\s*:\s*.+))\s*$/i;

function requirementName(match: RegExpMatchArray): string {
  return normalizeRequirementName(match[1] ?? match[2]);
}

function requirementNameFromHeader(header: string): string | undefined {
  const match = header.match(REQUIREMENT_HEADER_REGEX);
  return match ? requirementName(match) : undefined;
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

export function extractRequirementsSection(content: string): RequirementsSectionParts {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split('\n');
  const reqHeaderIndex = lines.findIndex((l) => /^##\s+Requirements\s*$/i.test(l));

  if (reqHeaderIndex === -1) {
    const before = content.trimEnd();
    const headerLine = '## Requirements';
    return {
      before: before ? before + '\n\n' : '',
      headerLine,
      preamble: '',
      bodyBlocks: [],
      after: '\n',
    };
  }

  let endIndex = lines.length;
  for (let i = reqHeaderIndex + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  const before = lines.slice(0, reqHeaderIndex).join('\n');
  const headerLine = lines[reqHeaderIndex];
  const sectionBodyLines = lines.slice(reqHeaderIndex + 1, endIndex);

  const blocks: RequirementBlock[] = [];
  let cursor = 0;
  let preambleLines: string[] = [];

  while (
    cursor < sectionBodyLines.length &&
    !REQUIREMENT_HEADER_REGEX.test(sectionBodyLines[cursor])
  ) {
    preambleLines.push(sectionBodyLines[cursor]);
    cursor++;
  }

  while (cursor < sectionBodyLines.length) {
    const headerLineCandidate = sectionBodyLines[cursor];
    const headerMatch = headerLineCandidate.match(REQUIREMENT_HEADER_REGEX);
    if (!headerMatch) {
      cursor++;
      continue;
    }
    const name = requirementName(headerMatch);
    cursor++;
    const bodyLines: string[] = [headerLineCandidate];
    while (
      cursor < sectionBodyLines.length &&
      !REQUIREMENT_HEADER_REGEX.test(sectionBodyLines[cursor]) &&
      !/^##\s+/.test(sectionBodyLines[cursor])
    ) {
      bodyLines.push(sectionBodyLines[cursor]);
      cursor++;
    }
    const raw = bodyLines.join('\n').trimEnd();
    blocks.push({ headerLine: headerLineCandidate, name, raw });
  }

  const after = lines.slice(endIndex).join('\n');
  const preamble = preambleLines.join('\n').trimEnd();

  return {
    before: before.trimEnd() ? before + '\n' : before,
    headerLine,
    preamble,
    bodyBlocks: blocks,
    after: after.startsWith('\n') ? after : '\n' + after,
  };
}

export interface DeltaPlan {
  added: RequirementBlock[];
  modified: RequirementBlock[];
  removed: string[];
  renamed: Array<{ from: string; to: string }>;
  sectionPresence: {
    added: boolean;
    modified: boolean;
    removed: boolean;
    renamed: boolean;
  };
}

function splitTopLevelSections(content: string): Record<string, string> {
  const lines = content.split('\n');
  const result: Record<string, string> = {};
  const indices: Array<{ title: string; index: number; level: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(##)\s+(.+)$/);
    if (m) {
      const level = m[1].length;
      indices.push({ title: m[2].trim(), index: i, level });
    }
  }
  for (let i = 0; i < indices.length; i++) {
    const current = indices[i];
    const next = indices[i + 1];
    const body = lines
      .slice(current.index + 1, next ? next.index : lines.length)
      .join('\n');
    result[current.title] = body;
  }
  return result;
}

function getSectionCaseInsensitive(
  sections: Record<string, string>,
  desired: string
): { body: string; found: boolean } {
  const target = desired.toLowerCase();
  for (const [title, body] of Object.entries(sections)) {
    if (title.toLowerCase() === target) return { body, found: true };
  }
  return { body: '', found: false };
}

function parseRequirementBlocksFromSection(sectionBody: string): RequirementBlock[] {
  if (!sectionBody) return [];
  const lines = normalizeLineEndings(sectionBody).split('\n');
  const blocks: RequirementBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && !REQUIREMENT_HEADER_REGEX.test(lines[i])) i++;
    if (i >= lines.length) break;
    const headerLine = lines[i];
    const m = headerLine.match(REQUIREMENT_HEADER_REGEX);
    if (!m) {
      i++;
      continue;
    }
    const name = requirementName(m);
    const buf: string[] = [headerLine];
    i++;
    while (
      i < lines.length &&
      !REQUIREMENT_HEADER_REGEX.test(lines[i]) &&
      !/^##\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ headerLine, name, raw: buf.join('\n').trimEnd() });
  }
  return blocks;
}

function parseRemovedNames(sectionBody: string): string[] {
  if (!sectionBody) return [];
  const names: string[] = [];
  const lines = normalizeLineEndings(sectionBody).split('\n');
  for (const line of lines) {
    const m = line.match(REQUIREMENT_HEADER_REGEX);
    if (m) {
      names.push(requirementName(m));
      continue;
    }
    const bullet = line.match(/^\s*-\s*`?(###\s*.+?)`?\s*$/);
    if (bullet) {
      const name = requirementNameFromHeader(bullet[1]);
      if (name) names.push(name);
    }
  }
  return names;
}

function parseRenamedPairs(
  sectionBody: string
): Array<{ from: string; to: string }> {
  if (!sectionBody) return [];
  const pairs: Array<{ from: string; to: string }> = [];
  const lines = normalizeLineEndings(sectionBody).split('\n');
  let current: { from?: string; to?: string } = {};
  for (const line of lines) {
    const fromMatch = line.match(/^\s*-?\s*FROM:\s*`?(###\s*.+?)`?\s*$/);
    const toMatch = line.match(/^\s*-?\s*TO:\s*`?(###\s*.+?)`?\s*$/);
    if (fromMatch) {
      current.from = requirementNameFromHeader(fromMatch[1]);
    } else if (toMatch) {
      current.to = requirementNameFromHeader(toMatch[1]);
      if (current.from && current.to) {
        pairs.push({ from: current.from, to: current.to });
        current = {};
      }
    }
  }
  return pairs;
}

export function parseDeltaSpec(content: string): DeltaPlan {
  const normalized = normalizeLineEndings(content);
  const sections = splitTopLevelSections(normalized);
  const addedLookup = getSectionCaseInsensitive(sections, 'ADDED Requirements');
  const modifiedLookup = getSectionCaseInsensitive(sections, 'MODIFIED Requirements');
  const removedLookup = getSectionCaseInsensitive(sections, 'REMOVED Requirements');
  const renamedLookup = getSectionCaseInsensitive(sections, 'RENAMED Requirements');
  const added = parseRequirementBlocksFromSection(addedLookup.body);
  const modified = parseRequirementBlocksFromSection(modifiedLookup.body);
  const removedNames = parseRemovedNames(removedLookup.body);
  const renamedPairs = parseRenamedPairs(renamedLookup.body);
  return {
    added,
    modified,
    removed: removedNames,
    renamed: renamedPairs,
    sectionPresence: {
      added: addedLookup.found,
      modified: modifiedLookup.found,
      removed: removedLookup.found,
      renamed: renamedLookup.found,
    },
  };
}
