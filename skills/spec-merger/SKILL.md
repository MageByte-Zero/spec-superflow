---
name: spec-merger
description: Sync delta specs to main specs after closure. Invoke when a change is closing, delta specs need merging into the main spec base, or when detecting spec drift across multiple changes.
---

# Spec Merger

## Overview

After a spec-superflow change completes, its delta specs (ADDED/MODIFIED/REMOVED/RENAMED) must be merged into the main specification base to prevent spec rot.

**Core principle:** Specs that aren't synced become lies. Delta specs are temporary; main specs are permanent.

## When to Use

- After `release-archivist` marks a change ready to archive
- When multiple changes have accumulated unsynced delta specs
- When the user asks about spec consistency
- When the workflow orchestrator detects stale main specs

### Pre-Flight: Conflict Detection

Before syncing, check for conflicts across unsynced changes:

1. Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/spec-superflow.mjs" sync <change-dir>`
2. If conflicts are detected, the CLI will report which requirements are modified by multiple changes
3. Present the conflict list to the user and ask for resolution order
4. Sync changes one at a time in the user-specified order

Alternatively, use the Validator API directly:
- Call `validator.detectSyncConflicts(deltaSpecs)` with all pending delta specs
- If `hasConflicts` is true, present conflicts before proceeding

### Pre-Flight: Abandoned Change Guard

Before syncing any delta specs:
1. Check if the change is in the `abandoned` state
2. If abandoned → STOP and report: "Abandoned changes cannot be synced. Delta specs from abandoned changes are preserved for reference but must not be merged into the main spec base."
3. If not abandoned → proceed with normal sync flow

## The Sync Process

### Step 1: Identify Delta Specs

Locate all delta spec files under the change folder:

```
changes/<change-name>/specs/
```

Each subdirectory is a capability. Each `spec.md` file contains the delta operations.

Delta operations are marked with headers:

- `## ADDED Requirements` — new requirements
- `## MODIFIED Requirements` — updated requirements
- `## REMOVED Requirements` — deprecated requirements
- `## RENAMED Requirements` — renamed requirements

### Step 2: For Each Capability

For each capability folder in the delta specs:

1. **Check if a main spec exists**: Look for `specs/<capability>/spec.md`
2. **If no main spec exists**: Create one from the ADDED requirements. Copy the full spec structure.
3. **If a main spec exists**: Apply each operation type:

#### ADDED Requirements

Append new requirements to the main spec file. Preserve the requirement name, description (SHALL/MUST statement), and all scenarios.

**Insertion point**: Before any existing REMOVED section, or at the end of the file if no REMOVED section exists.

#### MODIFIED Requirements

Update existing requirements by matching on requirement name (the `### Requirement: <name>` header).

1. Search the main spec for `### Requirement: <exact name>`
2. If found: Replace the requirement's description and scenarios with the delta version
3. If NOT found: Flag as a conflict — the requirement being modified doesn't exist in the main spec

**Do not delete the original.** Move the original text to a comment or a `### Previous version` subsection so the history is preserved.

#### REMOVED Requirements

Move the requirement to a `## Removed` section in the main spec (create this section if it doesn't exist).

1. Search the main spec for `### Requirement: <exact name>`
2. If found: Move it to the `## Removed` section with a deprecation note:
   ```markdown
   ### Requirement: <name> (Removed in <change-name>)
   
   **Reason**: <reason from delta>
   **Migration**: <migration from delta>
   ```
3. If NOT found: Flag as a conflict — the requirement being removed doesn't exist in the main spec

#### RENAMED Requirements

Apply a rename by matching the old name and updating the header:

1. Search the main spec for `### Requirement: <old name>`
2. If found: Change the header to `### Requirement: <new name>` and add a note:
   ```markdown
   _Renamed from `<old name>` in <change-name>_
   ```
3. If collides with an existing requirement name in the main spec: Flag as a conflict

### Step 3: Conflict Detection

Before executing any merge, detect these conflicts:

**Same requirement modified by multiple unsynced changes:**

- Scan all unsynced change folders for MODIFIED operations targeting the same requirement name
- Flag for manual resolution — you cannot automatically resolve conflicting modifications

**RENAMED colliding with existing requirement names:**

- If a rename target already exists as a different requirement in the main spec, flag it

**MODIFIED targeting requirements that don't exist:**

- If a delta says MODIFIED but the requirement name doesn't appear in the main spec, flag it
- This could mean: the requirement was already removed, a typo in the name, or the delta references a wrong capability

**Conflict Output Format:**

```
## Conflicts Requiring Manual Resolution

### Conflict: `<requirement-name>` modified by multiple changes
- Change A: `changes/feature-x/specs/auth/spec.md`
- Change B: `changes/feature-y/specs/auth/spec.md`
- Resolution needed: Manual merge of both modifications

### Conflict: RENAMED `<old-name>` → `<new-name>` collides with existing `<new-name>`
- Affected change: `changes/<change-name>/specs/<capability>/spec.md`
- Resolution needed: Choose unique name or merge requirements
```

### Step 4: Execute Merge

Apply changes to main specs following the rules in Step 2.

**Do NOT delete delta specs** — they remain in the change folder for traceability. The change folder is the historical record.

After merge, each main spec file should be self-consistent:

- No duplicate requirement names
- No orphaned references to removed requirements (check scenarios that reference removed requirements)
- The REMOVED section is clearly separated from active requirements

### Step 5: Report

Output a sync report:

```
## Spec Sync Report

### Change: <change-name>

| Capability | ADDED | MODIFIED | REMOVED | RENAMED | Status |
|------------|-------|----------|---------|---------|--------|
| auth       | 2     | 1        | 0       | 0       | ✓ Merged |
| ui-theme   | 0     | 3        | 1       | 1       | ✓ Merged |
| api        | 1     | 0        | 0       | 0       | ⚠ Conflict |

### Summary
- **Capabilities updated**: 3
- **Requirements added**: 3
- **Requirements modified**: 4
- **Requirements removed**: 1
- **Requirements renamed**: 1
- **Conflicts requiring manual resolution**: 1
```

## Guardrails

- Do not delete delta spec files — they are the change's historical record.
- Do not auto-resolve conflicts between multiple changes modifying the same requirement.
- Do not modify main specs without first checking for conflicts.
- Do not merge specs for a change that hasn't passed verification.
- If a merge would break cross-references between specs, flag it instead of proceeding.
- Main specs must remain self-consistent after every merge — validate after each capability.

## Post-Sync

After syncing:

1. Report the sync results to the user
2. If no conflicts: the change is fully ready to archive
3. If conflicts exist: present them clearly, the user resolves them before archive
4. The change folder (including delta specs) remains as-is for traceability

## Relationship to Other Skills

- Invoked by `release-archivist` after verification completes
- Can be invoked by `workflow-start` if stale main specs are detected
- Specs synced here become the new baseline for future `need-explorer` and `spec-writer` work

## Exception Handling

- **Parse failures**: If delta specs or main specs cannot be parsed, report the specific file and section. Do not attempt partial merges.
- **Missing files**: If the change directory has no delta specs (no ADDED/MODIFIED/REMOVED/RENAMED sections), report that there is nothing to merge and exit cleanly.
- **User interruption**: Merges are atomic operations on spec files. On resume, check if any spec file has merge conflict markers and resolve before proceeding.
