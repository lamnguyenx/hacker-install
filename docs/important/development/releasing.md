# Versioning and releases

Durable release contract for the project. Task-specific history lives in
[`../../plans/`](../../plans/).

## Version scheme

Versions use calendar versioning: `YYYY.MM.DD`, for example `2026.10.29`.

- `package.json` is the single source of truth.
- `src/version.ts` imports the version at build time, so `hi --version` reports whatever was
  present when `dist/npm/index.js` or a native binary was built.
- Rebuild after every bump. `prepublishOnly` already runs the build before an npm publish.

Git tags mirror the npm version with a `v` prefix: `v2026.10.29`.

## Release checklist

1. Confirm the working tree is clean and the identity is correct: package name
   `hacker-install`, only bin `hi`, repository `lamnguyenx/hacker-install`.
2. Bump `version` in `package.json`.
3. Run the full gate:

   ```bash
   bun install --frozen-lockfile
   bun run check
   bun test
   bun run build:npm
   bun run dev -- --version
   ```

4. Install the built bundle into a throwaway prefix and run `hi --version` / `hi --help`.
5. Commit the bump, then tag it: `git tag vYYYY.MM.DD`.
6. Publish to npm (see below), or create a GitHub release and let
   `.github/workflows/publish-npm.yml` publish.
7. Create the GitHub release so `.github/workflows/build.yml` uploads the native binaries and
   `checksums.txt`.
8. Verify the registry entry and a clean install.

The npm workflows trigger on `release: published` and `workflow_dispatch`. Both need the
version to be bumped before the release is created; they do not derive it from the tag.

## npm package

| Field    | Value                                 |
| -------- | ------------------------------------- |
| Package  | `hacker-install`                      |
| Command  | `hi` → `./dist/npm/index.js`          |
| Runtime  | Bun 1.4+ (the bundle is Bun-targeted) |
| Access   | public                                |
| Registry | `https://registry.npmjs.org/`         |
| Auth     | 2FA required by the npm account       |

`npm publish --access public` runs `prepublishOnly`
(`bun run check && bun test && bun run build:npm`), so a failing check blocks the release.

### Auth

A token can be present in `~/.npmrc` and still be expired. Check first:

```bash
npm whoami
```

If it returns 401, run `npm login --auth-type=web` and approve the browser flow. For CI, use an
automation/granular token in the `NPM_TOKEN` repository secret.

### Bun vs npm

With interactive web auth, Bun 1.4.3 can fail after approval with:

```text
404 Not Found: https://registry.npmjs.org/-/v1/done?authId=***
```

That is a failure in Bun's interactive auth path, not a registry problem. Publish with
`npm publish` instead. Token auth in CI avoids the interactive flow entirely.

### First publish of a new package

A brand-new package name is not immediately installable. npm exposes a temporary placeholder:

```text
0.0.0-stage  Temporary package placeholder for staged publishing
```

This is processing, not a staged release waiting for approval. Confirm with:

```bash
npm stage list        # should show no staged packages
npm view hacker-install version
```

The real version usually appears within a minute. Re-check before retrying.

### bin normalization

npm prints a warning like:

```text
"bin[hi]" script name dist/npm/index.js was invalid and removed
```

when the manifest uses `./dist/npm/index.js`. The path is normalized to `dist/npm/index.js`
and the bin is kept. The warning is misleading; verify the published manifest instead of
changing the build.

### Verify the published artifact

```bash
npm view hacker-install version bin

TMP=$(mktemp -d)
npm install --prefix "$TMP" hacker-install
"$TMP/node_modules/.bin/hi" --version
"$TMP/node_modules/.bin/hi" --help
rm -rf "$TMP"
```

A local `npm pack` only proves the working tree is packable; the registry manifest and a clean
install prove the release.

## GitHub Actions

| Workflow          | Trigger                   | Needs                                       |
| ----------------- | ------------------------- | ------------------------------------------- |
| `publish-npm.yml` | release published, manual | `NPM_TOKEN` secret                          |
| `build.yml`       | release published, manual | `contents: write` (built-in `GITHUB_TOKEN`) |

`publish-npm.yml` publishes only when `NPM_TOKEN` is set; otherwise the step is skipped
silently. Check the repository secrets before relying on a release to publish.

## Repository identity

- Canonical repository: `https://github.com/lamnguyenx/hacker-install`
- Archived Python implementation: `https://github.com/lamnguyenx/hacker-install-python`
- CLI command: `hi` only (the old `hacker-install-ts` command alias is retired)
- Completions: `~/.local/share/hacker-install/completions/` plus the
  `# hacker-install completion` marker in the shell rc file
