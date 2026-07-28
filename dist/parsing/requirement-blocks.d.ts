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
export declare function normalizeRequirementName(name: string): string;
export declare const REQUIREMENT_HEADER_REGEX: RegExp;
interface MarkdownLine {
    text: string;
    lineNumber: number;
    fenced: boolean;
}
export declare function scanMarkdownLines(content: string): MarkdownLine[];
export declare function extractRequirementsSection(content: string): RequirementsSectionParts;
export interface DeltaPlan {
    added: RequirementBlock[];
    modified: RequirementBlock[];
    removed: string[];
    renamed: Array<{
        from: string;
        to: string;
    }>;
    sectionPresence: {
        added: boolean;
        modified: boolean;
        removed: boolean;
        renamed: boolean;
    };
}
export declare function parseDeltaSpec(content: string): DeltaPlan;
export {};
