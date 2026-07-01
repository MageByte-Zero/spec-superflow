# 能力规格

## ADDED Requirements

### Requirement: Cursor Install Script Defaults to Latest Release

`scripts/install-cursor.mjs` SHALL, by default, download and install the latest GitHub release of `spec-superflow` into the current project's `.cursor/` directory.

#### Scenario: Default latest release install

- **WHEN** a user runs `node /absolute/path/to/install-cursor.mjs` in their project root
- **AND** no `--local` argument is provided
- **THEN** the script SHALL fetch the latest release tag from GitHub
- **AND** download the corresponding source tarball
- **AND** extract the tarball to a temporary directory
- **AND** copy `skills/` to `.cursor/skills/`
- **AND** create `.cursor/rules/phase-guard.mdc`
- **AND** report the installed version

#### Scenario: Local deployment override

- **WHEN** a user runs `node install-cursor.mjs --local /path/to/spec-superflow`
- **THEN** the script SHALL skip GitHub download
- **AND** use the provided local repository path as the source
- **AND** deploy skills and rules from that path

#### Scenario: Network failure fallback

- **WHEN** the GitHub API or tarball download fails
- **THEN** the script SHALL print a clear error message
- **AND** exit with a non-zero code
- **AND** SHALL NOT leave a partially populated `.cursor/skills/` directory

### Requirement: Update Check Script

`scripts/check-update.mjs` SHALL compare the local plugin version with the latest version published to npm and report whether an upgrade is available.

#### Scenario: Local version is latest

- **WHEN** `check-update.mjs` runs in a project with `spec-superflow` installed
- **AND** the local version equals npm latest
- **THEN** it SHALL output that the installation is up to date
- **AND** exit with code 0

#### Scenario: Local version is outdated

- **WHEN** `check-update.mjs` runs and the local version is lower than npm latest
- **THEN** it SHALL output the current and latest versions
- **AND** provide platform-appropriate upgrade commands:
  - Claude Code: `/plugin update spec-superflow@spec-superflow`
  - Cursor: re-run the install script
  - npm: `npm install -g spec-superflow@latest`
- **AND** exit with code 1

#### Scenario: Cannot determine version

- **WHEN** the local version cannot be read or npm is unreachable
- **THEN** it SHALL output a warning and exit with code 2

### Requirement: Workflow Start Checks for Updates

`workflow-start` SHALL run the update check during startup and surface any available upgrade to the user.

#### Scenario: Starting a new or existing change

- **WHEN** `workflow-start` is invoked
- **THEN** it SHALL run `node scripts/check-update.mjs`
- **AND** if exit code is 1, prepend a non-blocking upgrade reminder to its response
- **AND** continue with normal state detection

## MODIFIED Requirements

### Requirement: INSTALL.md Cursor Section

The Cursor installation section in `INSTALL.md` SHALL describe the new default behavior of `install-cursor.mjs`.

#### Scenario: User reads Cursor install instructions

- **WHEN** a user reads `INSTALL.md` under the Cursor section
- **THEN** they SHALL see a one-liner command that installs the latest release automatically
- **AND** they SHALL see the `--local` option documented for development/testing

## REMOVED Requirements

None.
