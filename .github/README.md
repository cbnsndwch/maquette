# GitHub Actions Workflows

## Release Workflow (Changesets)

This repository uses [Changesets](https://github.com/changesets/changesets) for automated version management and publishing.

### How it works

1. **Developer creates changeset**: When making changes, developers run `pnpm changeset` to describe what changed
2. **Release PR created**: When pushed to main, the workflow creates/updates a "Release: Version Packages" PR
3. **Review and merge**: Maintainers review the Release PR and merge when ready
4. **Automatic publishing**: Merging the Release PR triggers package publishing to npm

### Workflow triggers

- **Push to main branch**: Creates or updates Release PR
- **Manual trigger**: Can be triggered manually via GitHub Actions UI

### What it does

1. **Setup Environment**: Installs Node.js, pnpm, and dependencies
2. **Build & Test**: Runs `pnpm build` and `pnpm test`
3. **Changesets Action**: Uses the official Changesets GitHub Action to:
   - Create/update Release PR (if there are pending changesets)
   - OR publish packages to npm (if Release PR is merged)
4. **Create GitHub Release**: Automatically creates GitHub releases when packages are published

### Prerequisites

To use this workflow, you need to:

1. **Set up NPM Token**: Add an `NPM_TOKEN` secret to your repository
   - Go to Repository Settings > Secrets and variables > Actions
   - Add a new secret named `NPM_TOKEN`
   - The token should have permission to publish packages to npm

### Benefits over manual publishing

✅ **No manual version bumps** - Changesets calculates versions automatically  
✅ **Coordinated releases** - All related packages are versioned together  
✅ **Generated changelogs** - Meaningful changelogs from changeset descriptions  
✅ **Dependency tracking** - Automatically handles inter-package dependencies  
✅ **Review process** - Release PRs allow review before publishing  

## Legacy Publish Workflow

The `publish.yml` workflow is kept for reference but is no longer used. The new Changesets workflow in `release.yml` is the recommended approach.

---

## Original Publish Packages Workflow (Legacy)

This workflow automatically publishes all non-private packages in the monorepo when a tag is pushed to GitHub.

### Trigger

The workflow triggers on any tag push that matches the pattern `v*` (e.g., `v1.0.0`, `v2.1.3`, etc.).

### What it does

1. **Setup Environment**: Installs Node.js 22, pnpm, and sets up caching
2. **Install Dependencies**: Runs `pnpm install --frozen-lockfile`
3. **Build**: Executes `pnpm run build` to build all packages
4. **Test**: Runs `pnpm run test` to ensure all tests pass
5. **Identify Publishable Packages**: Scans workspace packages to find non-private packages
6. **Publish**: Publishes each non-private package to npm with provenance
7. **Create Release**: Creates a GitHub release with the tag

### Prerequisites

To use this workflow, you need to:

1. **Set up NPM Token**: Add an `NPM_TOKEN` secret to your repository
   - Go to Repository Settings > Secrets and variables > Actions
   - Add a new secret named `NPM_TOKEN`
   - The token should have permission to publish packages to npm

2. **Package Configuration**: Ensure your publishable packages have:

   ```json
   {
     "private": false,  // or omit this field entirely
     "publishConfig": {
       "access": "public",
       "registry": "https://registry.npmjs.org/"
     }
   }
   ```

3. **Build Output**: Make sure your packages generate build output in `dist/`, `build/`, or `lib/` directories, or are configuration packages (like `oxlint-config` or `tsconfig` packages)

### Usage

To trigger a release:

```bash
# Create and push a tag
git tag v1.0.0
git push origin v1.0.0
```

Or use GitHub CLI:

```bash
gh release create v1.0.0 --generate-notes
```

### Package Detection

The workflow automatically detects publishable packages by:

- Using `pnpm list --recursive` to find all workspace packages
- Filtering out packages marked as `"private": true`
- Checking for the presence of build output directories
- Validating package.json has a valid name field

### Security Features

- Uses npm provenance for package authenticity
- Performs dry-run before actual publish
- Validates build outputs exist before publishing
- Uses minimal required permissions

### Example Output

When successful, the workflow will:

- Publish packages like `@cbnsndwch/contracts@1.0.0`, `@cbnsndwch/oxlint-config@1.0.0`, `@cbnsndwch/tsconfig@1.0.0`
- Create a GitHub release with the tag
- Include a list of published packages in the release notes
