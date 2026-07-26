# Spec Publication

## ADDED Requirements

### Requirement: Verified publication receipt

The system SHALL persist a publication receipt after synchronizing a change delta to the project baseline, containing the source delta hash, the affected capability paths, and the resulting baseline hash.

#### Scenario: Closing after an unchanged publication

- **WHEN** a change with delta specs has been synchronized and neither its delta nor its published capability baseline has changed
- **THEN** the closing guard accepts the publication receipt.

#### Scenario: Publication evidence becomes stale

- **WHEN** a change delta or one of its published capability baselines changes after synchronization
- **THEN** the closing guard rejects closure and requires synchronization again.

### Requirement: Delta application to published baseline

The system SHALL apply ADDED, MODIFIED, REMOVED, and RENAMED requirement operations to the root baseline specification without persisting delta section headers in that baseline.

#### Scenario: Adding a requirement

- **WHEN** a change delta adds a requirement to a capability
- **THEN** the corresponding root `specs/<capability>/spec.md` contains that requirement under `## Requirements`.

#### Scenario: Modifying a requirement

- **WHEN** a change delta modifies an existing requirement
- **THEN** the root baseline replaces that requirement while preserving other baseline requirements.

### Requirement: Active change isolation

The system SHALL use `changes/<change>/` as the sole artifact source for active workflow transitions and SHALL not use root baseline specs as transition inputs.

#### Scenario: Transition before publication

- **WHEN** an active change has valid local planning artifacts and no published baseline yet
- **THEN** its planning transition is evaluated only against artifacts inside that change.

### Requirement: Delta spec synchronization before closure

The system SHALL require a valid publication receipt, rather than an unverified `spec_merged` flag, before a change containing delta specs can transition from executing to closing.

#### Scenario: Legacy boolean without a receipt

- **WHEN** a change records `spec_merged: true` but lacks valid publication evidence
- **THEN** the closing guard rejects the transition.
