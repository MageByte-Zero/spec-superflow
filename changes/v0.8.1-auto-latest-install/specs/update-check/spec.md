# 能力规格

## ADDED Requirements

### Requirement: Update Check Reminder on Workflow Start

`workflow-start` SHALL compare the locally installed `spec-superflow` version against the latest npm version and remind the user to upgrade if behind.

#### Scenario: Outdated plugin

- **WHEN** `workflow-start` starts
- **AND** `scripts/check-update.mjs` reports an outdated version
- **THEN** `workflow-start` SHALL display a reminder with the current version, latest version, and upgrade command
- **AND** SHALL still proceed with normal workflow routing

#### Scenario: Up-to-date plugin

- **WHEN** `workflow-start` starts
- **AND** `scripts/check-update.mjs` reports up to date
- **THEN** no reminder is shown

#### Scenario: Check script unavailable

- **WHEN** `scripts/check-update.mjs` does not exist or fails
- **THEN** `workflow-start` SHALL silently skip the check

## MODIFIED Requirements

None.

## REMOVED Requirements

None.
