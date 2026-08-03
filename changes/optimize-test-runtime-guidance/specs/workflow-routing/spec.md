## ADDED Requirements

### Requirement: Explicit phase handoff guidance

Every workflow skill SHALL end every normal, blocked, or approval-waiting user-facing phase report with the detected current stage, completed work (or the blocking fact), the next stage, and the condition required to enter it. Only `abandoned` and a successfully persisted `closing` state are terminal and SHALL state that no next stage exists.

#### Scenario: Complete a non-terminal workflow phase

- **WHEN** a workflow skill completes its assigned non-terminal phase
- **THEN** it tells the user what was completed
- **AND** names the next stage and its entry condition

#### Scenario: Pause for a gate or blockage

- **WHEN** a workflow skill cannot advance because approval, validation, or a defect is unresolved
- **THEN** it identifies the blocking fact as the completed/known status
- **AND** names the next stage that will run after the gate is satisfied

#### Scenario: Report a successful terminal workflow phase

- **WHEN** a workflow skill detects a successfully persisted `closing` state or `abandoned`
- **THEN** it tells the user that no next stage exists

#### Scenario: Report release work before successful close

- **WHEN** release verification or archive work is still running before the `executing → closing` transition succeeds
- **THEN** it reports the remaining release step as the next stage rather than claiming a terminal state

### Requirement: Risk-adaptive execution discipline

The workflow SHALL use a lightweight execution path only for low-uncertainty changes limited to tests, documentation, or test-support code. It MUST retain the Full path for any production behavior, public CLI/API/module/package-export, installer, state-machine, external-side-effect, data, permission, configuration-semantics, or high-uncertainty change. A request is high uncertainty when any eligibility condition cannot be proven from the request and affected paths, including unclear expected behavior, non-reproducible verification, or incomplete impact paths.

#### Scenario: Route an eligible internal change

- **WHEN** a requested change is limited to tests, documentation, or test-support code and has no excluded risk signal
- **THEN** the workflow records affected paths, exclusion checks, the one scope confirmation, verification strategy/result, and any escalation reason in `.superpowers/sdd/workflow-selection.json`
- **AND** it executes one bounded batch and performs one focused review
- **AND** it does not require a full planning pack, execution contract, DP-3, DP-4, wave plan, or per-task receipt

#### Scenario: Route an excluded change

- **WHEN** a requested change includes any excluded risk signal
- **THEN** the workflow selects or preserves the Full path
- **AND** the Full path continues to require its planning, contract, approval, execution-plan, and review controls

#### Scenario: Escalate when risk appears during lightweight execution

- **WHEN** an excluded risk signal or material uncertainty appears after lightweight execution begins
- **THEN** the workflow stops lightweight execution before the affected change proceeds
- **AND** routes the change to the Full path with the discovered risk recorded

#### Scenario: Miss the runtime target after executing

- **WHEN** the unchanged-scope optimization exceeds the 180-second reference target
- **THEN** the workflow records suite-duration evidence and returns from `executing` to `bridging` to rebuild the contract
- **AND** it returns to `specifying` and repeats DP-2 only when the objective or scope changes
