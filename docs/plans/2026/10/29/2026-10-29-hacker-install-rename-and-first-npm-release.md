# Plan: Rename to `hacker-install` and publish the first npm release (2026-10-29)

Status: done
Scope: drop the `-ts` suffix from the project, package, and repository; keep `hi` as the only
command; move the project to CalVer; publish `hacker-install@2026.10.29` to npm.

## Goals

1. Rename the package, repository, user agent, update hints, and completion paths from
   `hacker-install-ts` to `hacker-install`.
2. Keep the CLI invocation exactly as it was: `hi`.
3. Free the `hacker-install` GitHub name by archiving the old Python implementation.
4. Switch from `0.1.x` to calendar versioning and publish `2026.10.29` to npm.
5. Verify the published tarball with a clean install, not just a local build.

## 1. Code and package rename

The rename is more than a `package.json` rename. Everything that exposed the old identity had
to change together:

| File                    | Change                                                                   |
| ----------------------- | ------------------------------------------------------------------------ |
| `package.json`          | `name: hacker-install`; `bin` reduced to `{ "hi": ... }`                 |
| `package.json`          | repository, homepage, and bugs URLs point at `lamnguyenx/hacker-install` |
| `bun.lock`              | workspace name updated                                                   |
| `src/version.ts`        | `PROJECT_NAME`, `PROJECT_REPO`                                           |
| `src/cli.ts`            | `--help` description repo URL                                            |
| `src/http.ts`           | `USER_AGENT = "hacker-install"`                                          |
| `src/app/me.ts`         | global-update hints: `bun/npm update -g hacker-install`                  |
| `src/app/completion.ts` | completions live in `~/.local/share/hacker-install/completions`          |
| `src/app/completion.ts` | rc marker is `# hacker-install completion`                               |
| `README.md`             | badges, install commands, clone URL, npm package name                    |
| `test/me.test.ts`       | fixture paths and global-install detection                               |

The old manifest exposed two commands (`hi` and `hacker-install-ts`). The new package exposes
only `hi`, matching the project's actual interface.

### Completion migration

Changing both the completion directory and the marker means an existing shell rc file can end
up with a second `source` line. The old line still points at a valid script, so nothing breaks,
but users should re-run:

```bash
hi --install-completion zsh   # or bash / fish
```

and delete the old `# hacker-install-ts completion` block from their rc file.

## 2. Moving the GitHub repository

Both names existed:

```text
lamnguyenx/hacker-install       Python (old implementation)
lamnguyenx/hacker-install-ts    TypeScript/Bun (this repo)
```

Decision: archive the Python repository and give its name to the maintained TypeScript
implementation.

### What did not work

```bash
gh repo archive lamnguyenx/hacker-install --yes
gh repo rename hacker-install --yes
# HTTP 422: name already exists on this account
```

Archiving does **not** release a repository name. The archived repository still owns
`hacker-install`.

Renaming the archived repository directly also failed:

```bash
gh repo rename hacker-install-python --repo lamnguyenx/hacker-install --yes
# HTTP 403: Repository was archived so is read-only.
```

### What worked

1. Unarchive the Python repository.
2. Rename it to `hacker-install-python`.
3. Archive it again.
4. Rename the TypeScript repository to `hacker-install`.

```bash
gh repo unarchive lamnguyenx/hacker-install --yes
gh repo rename hacker-install-python --repo lamnguyenx/hacker-install --yes
gh repo archive lamnguyenx/hacker-install-python --yes
gh repo rename hacker-install --yes
```

`gh repo rename` updates the local `origin` automatically:

```text
origin  git@github.com:lamnguyenx/hacker-install.git (fetch)
origin  git@github.com:lamnguyenx/hacker-install.git (push)
```

The local checkout was also renamed:

```bash
mv /Users/lamnt45/git/hacker-release-ts /Users/lamnt45/git/hacker-install
```

Because that changes the session's working directory, the session was moved with
`session_move` instead of continuing from a path that no longer exists.

The existing `bun link` installation still pointed at `hacker-release-ts`, so it was rebuilt:

```bash
rm -f ~/.bun/bin/hi ~/.bun/install/global/node_modules/hacker-install-ts
bun link
~/.bun/bin/hi --version   # 2026.10.29
```

## 3. Calendar versioning

`package.json` moved from `0.1.1` to `2026.10.29`.

- Format: `YYYY.MM.DD`.
- `src/version.ts` reads `package.json` at build time, so the version is baked into the npm
  bundle and standalone binaries.
- Always rebuild after a bump; `prepublishOnly` does this automatically for npm.

## 4. First npm publish

### Auth failure

The token in `~/.npmrc` looked present but was no longer valid:

```text
$ npm whoami
npm error code E401
npm error 401 Unauthorized - GET https://registry.npmjs.org/-/whoami
```

Fix: `npm login --auth-type=web`, then approve the CLI login in the browser. The account is
`lamnguyenx`.

### `bun publish` failure

The first publish attempt appeared to hang. Running it with a logged TTY showed it was waiting
for browser approval. After approval, Bun failed on npm's callback:

```text
Authenticate your account at:
https://www.npmjs.com/auth/cli/<id>

404 Not Found: https://registry.npmjs.org/-/v1/done?authId=***
```

That is a failure in Bun's interactive auth path (the registry returns 404 for the URL Bun
requests), not a problem with the package. The fallback was the npm CLI, which completed the
same web-auth flow successfully:

```bash
npm publish --access public
```

`npm publish` ran `prepublishOnly`:

```text
bun run check && bun test && bun run build:npm
```

### First-publish placeholder

Immediately after the publish command returned, the registry showed only:

```text
versions: ['0.0.0-stage']
description: Temporary package placeholder for staged publishing
```

This was **not** a staged publish waiting for approval — `npm stage list` returned no staged
packages. npm uses `0.0.0-stage` as a temporary placeholder while processing a brand-new
package name. About one minute later:

```text
versions: ['0.0.0-stage', '2026.10.29']
latest: 2026.10.29
```

### npm bin warning

npm printed:

```text
npm warn publish "bin[hi]" script name dist/npm/index.js was invalid and removed
```

The message is misleading. npm normalizes `./dist/npm/index.js` to `dist/npm/index.js` and
still records the bin. The published manifest was verified:

```json
{ "bin": { "hi": "dist/npm/index.js" } }
```

## Errors, trials and dead ends

| #   | Symptom                                                        | Root cause                                                    | Fix                                                          |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | `gh repo rename` returned 422 "name already exists"            | Archived repositories keep their name reserved                | rename the old repo away first                               |
| 2   | Renaming the archived Python repo returned 403 "read-only"     | Archived repositories cannot be modified                      | unarchive, rename, archive again                             |
| 3   | `npm whoami` returned 401                                      | Token in `~/.npmrc` was expired/revoked                       | `npm login --auth-type=web`                                  |
| 4   | `bun publish` produced no output for minutes                   | It was waiting for 2FA browser approval                       | run it with a TTY/log and approve the URL                    |
| 5   | `bun publish` ended with 404 on `/-/v1/done?authId=...`        | Bun's interactive web-auth callback was rejected              | publish with `npm publish`                                   |
| 6   | `npm view hacker-install` returned 404 right after publishing  | First-publish processing and registry propagation             | wait and re-check; the package was live about a minute later |
| 7   | Registry showed only `0.0.0-stage`                             | Temporary placeholder for a new package, not a staged release | wait for processing; verify `2026.10.29` appears             |
| 8   | npm warned that `bin[hi]` was "invalid and removed"            | npm normalizes the `./` prefix; the warning text is wrong     | verify the tarball manifest, no action needed                |
| 9   | `hi` symlink pointed at the old checkout after the folder move | `bun link` stores an absolute path to the checkout            | remove the old links, run `bun link` again                   |
| 10  | Existing completion block points at the old directory/marker   | Both path and marker contained `hacker-install-ts`            | re-run completion install; remove the old rc block           |

## Lessons learnt

1. **A rename is an identity change, not a string replace.** Package name, URLs, user agent,
   update hints, completion paths, tests, and the lockfile all encode the old name.
2. **GitHub names are not freed by archiving.** Archived repositories are read-only _and_
   still reserve their name; unarchive → rename → archive is the working sequence.
3. **`gh repo rename` keeps the remote in sync.** No manual `git remote set-url` was needed.
4. **Moving a checkout breaks `bun link`.** Global links store absolute paths; re-link after
   moving the directory.
5. **A token in `.npmrc` is not proof of auth.** `npm whoami` is the one-line check; expiry is
   invisible otherwise.
6. **Interactive publish auth is a fragile path.** Bun's web-auth callback failed, npm CLI's
   worked. Keep a fallback and prefer token auth in CI.
7. **A first publish is not instant.** A `0.0.0-stage` placeholder is normal while npm processes
   a new package; re-check the registry before assuming failure.
8. **Trust the published artifact, not the local pack output.** Verify the registry manifest
   and install the tarball into a clean prefix; npm normalization can change paths.
9. **Versions are compiled in.** Rebuild the npm bundle after every bump or `hi --version`
   will lie.
10. **Publishing is effectively one-way.** Check name, version, bin entry, and tarball contents
    before running `npm publish`.

## Verification

```bash
bun install --frozen-lockfile
bun run check                  # biome + tsc clean
bun test                       # 129 pass, 301 assertions
bun run build:npm
bun run dev -- --version       # 2026.10.29

npm view hacker-install version bin
# 2026.10.29
# { hi: 'dist/npm/index.js' }

TMP=$(mktemp -d)
npm install --prefix "$TMP" hacker-install@2026.10.29
"$TMP/node_modules/.bin/hi" --version   # 2026.10.29
"$TMP/node_modules/.bin/hi" --help      # Reaches the new repo URL
rm -rf "$TMP"
```

The published tarball contains `package.json`, `README.md`, `LICENSE`, and
`dist/npm/index.js`.

## Follow-ups

- Add an `NPM_TOKEN` repository secret for `.github/workflows/publish-npm.yml`. The publish
  step is skipped while the secret is missing. Token auth also avoids the interactive web-auth
  failure seen with `bun publish`; consider using `npm publish` in CI.
- Existing users should remove the old `# hacker-install-ts completion` block and re-run
  `hi --install-completion <shell>`.
- Create the `v2026.10.29` Git tag/release if the GitHub release assets and CI publish should
  ship alongside the npm release.
- Commit the rename and version bump first. This publish was built from the working tree, so
  the npm tarball predates any tag; publish from a clean commit in future runs.
- Old GitHub URLs redirect automatically after the repository rename; update external links
  only when convenient.
