# verification-framework Spec

## MODIFIED Requirements

### Requirement: Three-Dimensional Verification

release-archivist SHALL verify implementation quality across three orthogonal dimensions: Completeness, Correctness, and Coherence.

#### Scenario: Completeness verification

- **WHEN** release-archivist runs the Completeness dimension
- **THEN** it SHALL verify that every task in tasks.md has a corresponding code change
- **AND** every SHALL/MUST requirement in specs/ has at least one implementation artifact
- **AND** every delta spec operation (ADDED/MODIFIED/REMOVED/RENAMED) is reflected in the code changes
- **AND** SHALL report missing items as CRITICAL issues

#### Scenario: Correctness verification

- **WHEN** release-archivist runs the Correctness dimension
- **THEN** it SHALL verify that all tests pass with zero failures
- **AND** boundary conditions identified in specs are covered by test cases
- **AND** error handling paths specified in design.md are implemented
- **AND** each Scenario's GIVEN/WHEN/THEN has a corresponding test assertion
- **AND** SHALL report failures as CRITICAL issues

#### Scenario: Coherence verification

- **WHEN** release-archivist runs the Coherence dimension
- **THEN** it SHALL verify that design.md decisions are visible in the code (naming, patterns, architecture)
- **AND** naming conventions are consistent across implementation and specs
- **AND** no "say one thing, do another" patterns exist (spec describes behavior X but code implements Y)
- **AND** SHALL report inconsistencies as IMPORTANT issues

### Requirement: Verification Dimension Report

release-archivist SHALL produce a structured verification report with per-dimension results and an overall verdict.

#### Scenario: Report structure

- **WHEN** all three dimensions have been verified
- **THEN** release-archivist SHALL produce a report containing:
  - Per-dimension status: PASS / FAIL / WARN
  - Per-dimension findings list (issue level + description)
  - Overall verdict: PASS (all dimensions PASS), CONDITIONAL (WARN only), FAIL (any CRITICAL)
- **AND** SHALL NOT claim completion unless overall verdict is PASS or user accepts CONDITIONAL

### Requirement: Implementation Validator Engine

The Validator class SHALL provide a `validateImplementation()` method that accepts a diff summary, spec content, and design content, and returns a VerificationReport.

#### Scenario: validateImplementation API

- **WHEN** `validateImplementation(diffSummary, specContent, designContent)` is called
- **THEN** it SHALL return a `VerificationReport` object with:
  - `dimensions`: array of `{ name: VerificationDimension, status: 'PASS'|'FAIL'|'WARN', findings: VerificationFinding[] }`
  - `verdict`: `'PASS' | 'CONDITIONAL' | 'FAIL'`
- **AND** the method SHALL check for placeholder markers in the diff summary
- **AND** the method SHALL verify that all SHALL/MUST requirements from specContent appear in the diff summary

#### Scenario: Verification types exported

- **WHEN** a consumer imports from spec-superflow
- **THEN** the following types SHALL be available: `VerificationDimension`, `VerificationStatus`, `VerificationFinding`, `VerificationReport`
