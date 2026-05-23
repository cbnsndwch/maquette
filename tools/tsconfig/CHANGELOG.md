# @cbnsndwch/tsconfig

## 0.9.0

### Minor Changes

- ffafb1c: ## Tooling Maintenance and Linting Overhaul

  ## Overview

  This PR introduces a significant refactoring of our code quality tooling by replacing ESLint and Prettier with Oxlint and Oxfmt for improved performance. It also cleans up legacy GitHub actions, updates core dependencies, and synchronizes our workspace settings to reflect these workflow changes.

  ## Key Changes

  ### 🛠️ Linting and Formatting Tooling Migration

  - **Added `oxlint` & `oxfmt`**: Introduced configuration files (`.oxlintrc.json` and `.oxfmtrc.json`).
  - **Removed ESLint & Prettier**: Safely removed all ESLint configurations (`.eslintrc.js`, `tools/eslint-config/`) and Prettier configurations (`.prettierrc.json`, `.prettierignore`) from the workspace.
  - **Removed specific configurations** from the `libs/contracts` library and the shared ESLint `tools` packages.

  ### 📦 Dependency and Package Version Updates

  - Updated `pnpm` in the workspace to the latest version (`10.32.1`) in the `packageManager` field.
  - Updated `pnpm-lock.yaml` with extensive resolution updates for dev dependencies.
  - Updated multiple `@nestjs/*`, `typescript`, `@types/*`, `vitest`, `commitlint`, and `lint-staged` dependencies in the `contracts` package.
  - Removed legacy package scripts and dependency configs no longer needed (including tools like `eslint-config`).
  - Bumped component library versions (`monorepo-base`, `tsconfig`, `contracts`) and updated `CHANGELOG.md` files accordingly tracking changeset releases.

  ### ⚙️ CI/CD & Workspace Config Updates

  - **Removed Legacy Action Workflow**: Deleted `.github/workflows/publish-legacy.yml` in favor of existing unified release flows (`release.yml`).
  - Adjusted `.vscode/settings.json` and `.vscode/extensions.json` to leverage oxlint, oxfmt and optimize the development experience for VS Code.
  - Replaced TurboRepo (`turbo.json`) `tui` UI feature target with `stream`.
  - Removed `PRIVATE-REPO-FIX.md` documentation which is no longer required.
  - Refactored script cleanup like dropping backup git changelogs.

  ## Testing / Checks

  - [ ] Run `pnpm build` to verify Turbo stream task completion.
  - [ ] Ensure formatting works efficiently using `oxfmt`.
  - [ ] Verify that internal `.git` hook validation passes without `eslint` reliance.

## 0.8.0

### Minor Changes

- 8e8fe56: Package version routine maintenance

## 0.6.0

### Minor Changes

- b0ceff6: Drop CommonJS compatibility and move to ESM-only.

## 0.5.7

### Patch Changes

- cf03d03: add readmes

## 0.5.6

### Patch Changes

- 377c860: fix: disable npm provenance for private repositories and update documentation

## 0.5.5

### Patch Changes

- a9b6b67: update github workflow

## 0.0.2

### Patch Changes

- set up changesets
