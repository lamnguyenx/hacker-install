# Plan: Global install, Python sunset, responsive `hi ls` (2026-10-26)

Status: done
Scope: install this repo as the global `hi`, collapse config/state into one location,
retire the Python implementation, and make `hi ls` readable in a narrow terminal.

## Goals

1. Install `hi` globally from the local checkout and keep it tracking the working tree.
2. Make `~/.config/hacker/hacker-install/config.jsonc` the only config file.
3. Sunset the Python version, including its schema and migration tooling.
4. Replace the bordered `hi ls` table with width-aware output that uses bold/italic/underline
   and colour, and never breaks when piped.

## 1. Installing `hi` globally

### First attempt

```bash
bun add -g .
# error: refusing to install dependency with unsafe name
# installed @
# Failed to install 1 package
```

### Investigation

- Reproduced in an empty throwaway project that only had `{"bin": {"hi": "./cli.js"}}`:
  `bun add -g .` failed with the same message. So this was not repo-specific.
- `bun add -g "$(pwd)"` (absolute path) worked.
- `bun install -g .` failed the same way as `bun add -g .`.
- Conclusion: **Bun 1.4.3 resolves a relative global spec to the empty package name** `""`
  and then refuses it as unsafe. Absolute local paths are fine.

### Side effects of the failed attempts

| Manifest            | Junk added                  | Cause                           |
| ------------------- | --------------------------- | ------------------------------- |
| repo `package.json` | `"hacker-install-ts": "./"` | `bun add .` (local, not global) |
| `~/package.json`    | `"": "."`                   | `bun add -g .` run from `$HOME` |

`~/package.json` mattered because on this machine Bun's global root is `$HOME`:

```text
$ bun pm bin -g
/Users/lamnt45/.bun/bin
$ bun pm ls -g
/Users/lamnt45 node_modules (571 installed)
```

So the empty-name dependency sat in the global manifest and made **every** global install
print the unsafe-name error, including a later `bun add -g "$(pwd)"` that otherwise worked.

Cleanup that fixed it:

1. Remove `"hacker-install-ts": "./"` from the repo manifest; remove the self-link from
   `node_modules`; `bun install` (lockfile restored, no diff).
2. Remove `"": "."` from `~/package.json`; remove `~/node_modules/hacker-install-ts`;
   `bun install` in `$HOME`.
3. Rebuild and link:

```bash
cd /Users/lamnt45/git/hacker-release-ts
bun run build:npm
bun link
```

`bun link` creates a real symlink, so the global command tracks the checkout:

```text
~/.bun/install/global/node_modules/hacker-install-ts -> /Users/lamnt45/git/hacker-release-ts
~/.bun/bin/hi -> ../install/global/node_modules/hacker-install-ts/dist/npm/index.js
```

### Stale `dist` surprise

`hi --version` printed `0.1.0` while `package.json` said `0.1.1`. `src/version.ts` reads
`pkg.version` at build time, and the bundle in `dist/npm` predated the bump. Always rebuild
before judging the linked CLI.

### Result

```text
$ which hi
/Users/lamnt45/.bun/bin/hi
$ hi --version
0.1.1
```

Alternatives that **copy** instead of link: `bun add -g "$PWD"` and `npm i -g .` — both need
to be re-run after every change.

## 2. Where downloads go (`bundlePath`)

The question that started this: "can `hi` download tarballs to `~/Downloads2` and symlink
into `~/.local/bin`?"

Findings (`src/providers/git/main.ts:464`, `src/helper/install.ts:90`):

- `bundlePath` (default `~/Downloads2`) hosts per-install temp dirs `dn_<repo>_<rand>/`.
- Those temp dirs — and therefore the downloaded archive — are **always deleted** in a
  `finally` block.
- **Directory bundles** (archive containing `bin/<name>`) are moved to
  `<bundlePath>/<name>/`, and `<installPath>/<name>` becomes a symlink to
  `<bundlePath>/<name>/bin/<name>`. This is exactly the "download + symlink" flow.
- **Single binaries** are copied with `install <src> <installPath>/<name>`: no symlink,
  no retained archive.
- `hi get` always passes `local = true`, so `sudo` is never used.

Conclusion: the wanted flow exists only for multi-file bundles. Keeping the `.tgz` and
symlinking single binaries is a feature, not a config option (tracked as a follow-up).

Also: the file the user had open (`~/.config/hacker/hacker-install/config.jsonc`) was in the
**Python schema** and was not read by the TS CLI at all — see the next section.

## 3. Sunsetting the Python version

Before this change there were two namespaces and two schemas:

|              | Python                                                | TS before                                            | TS now                                            |
| ------------ | ----------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Config       | `~/.config/hacker/hacker-install/config.jsonc`        | `~/.config/hacker/hacker-install-ts/config.jsonc`    | `~/.config/hacker/hacker-install/config.jsonc`    |
| State        | `~/.local/state/hacker/hacker-install/state.json`     | `~/.local/state/hacker/hacker-install-ts/state.json` | `~/.local/state/hacker/hacker-install/state.json` |
| Config shape | `{"config": {token, path, bundle_path, pre_release}}` | flat camelCase                                       | flat camelCase                                    |
| State shape  | flat map keyed `<source>#<name>`, snake_case          | `{version, tools}`                                   | `{version, tools}`                                |

Decision: the TS CLI owns the neutral `hacker/hacker-install` namespace for **both** files,
and the Python implementation is retired.

### Data migration performed on this machine

1. Backed up both old files to a temp dir (see follow-ups — temp is not durable).
2. Ran the existing helper **one last time before deleting it**:

   ```bash
   bun run migrate:python
   # Migrated config: .../hacker-install/config.jsonc -> .../hacker-install-ts/config.jsonc
   # Migrated 1 tool(s) to .../hacker-install-ts/state.json
   ```

   This converted `code-server` from the flat `<url>#code-server` key to
   `{version: 1, tools: { "code-server": {...} }}` with camelCase fields.
3. Moved both converted files into the neutral directories and removed the `-ts` dirs.
4. Verified with `hi config`, `hi state`, `hi ls`.

### Code changes

| File                             | Change                                                                   |
| -------------------------------- | ------------------------------------------------------------------------ |
| `src/paths.ts`                   | `APP_NAMESPACE = hacker/hacker-install` (was `hacker/hacker-install-ts`) |
| `scripts/migrate-from-python.ts` | deleted (Python is sunset)                                               |
| `package.json`                   | removed the `migrate:python` script                                      |
| `src/schemas.ts`                 | legacy Python config/state now raise actionable errors                   |
| `test/config-state.test.ts`      | new XDG expectations + legacy-format tests                               |
| `README.md`                      | paths, examples, "Upgrading from the Python version"                     |

### Why the guards matter

`parseToolState` used to treat any object without `tools` as `{tools: {}}`. With the paths
now shared, a leftover Python `state.json` would have loaded as **empty** and then been
overwritten on the next save — silent data loss. Both parsers now refuse the old shape:

```text
Legacy Python config detected (nested 'config' object). Back it up and delete it,
then re-run 'hi config' with the settings you want.

Legacy Python state detected (flat '<source>#<name>' map). Back it up and delete it,
then reinstall your tools with 'hi get'.
```

## 4. `hi ls` for narrow terminals

### Before

A `cli-table3` box with six columns (Name, Version, Type, Hold, Source, Description) and
~100 characters of borders. In a narrow terminal it wrapped into unreadable shreds, and the
description column was mostly wasted space.

### After

```
Installed tools (2)

  code-server · v4.143.1 · binary · github
  github.com/coder/code-server · VS Code in the browser

  lazygit · v0.54.1 · binary · github · held
  github.com/jesseduffield/lazygit · Simple terminal UI for git commands
```

Renderer: `src/ui/list.ts` (`renderToolList`), used by `listInstalled` in
`src/app/manage.ts`.

Rules:

- Width: `process.stdout.columns` → `COLUMNS` → 80. When output is piped (`!io.isTTY`),
  width is `0` and nothing is truncated, so `hi ls | grep` stays intact.
- Priority: name → version → type → provider → held. Tags that don't fit are **dropped
  whole**, never cut mid-word (`code-server · v4.143.1 · binary`, not `... · gith…`).
- Only the name is truncated when it alone overflows (`some-extremely-long…`).
- The description is dropped when fewer than 16 columns remain (avoids `· VS Cod…` noise).
- Entries are sorted alphabetically and separated by a blank line.
- `--json` output is unchanged; `provider` is text-only.

Styles:

| Element             | Style                   |
| ------------------- | ----------------------- |
| Title               | bold + underline + cyan |
| Count               | dim                     |
| Name                | bold cyan               |
| Version             | green                   |
| Type, provider, `·` | dim                     |
| `held`              | bold yellow             |
| Source              | dim + underline         |
| Description         | dim + italic            |

Tests: `test/list.test.ts` covers width clamping, tag dropping, the hold marker, and the
no-truncation-when-piped path.

## Errors, trials and dead ends

| #   | Symptom                                                                   | Root cause                                                                            | Fix                                                |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | `refusing to install dependency with unsafe name` + `installed @`         | Bun 1.4.3 resolves `bun add -g .` to the empty package name                           | use `bun link`, or an absolute path                |
| 2   | Repo gained a self-dependency `hacker-install-ts: "./"`                   | `bun add .` ran in the repo                                                           | remove the entry, reinstall                        |
| 3   | Every later global install still printed the unsafe-name error            | `~/package.json` contained `"": "."` (home is Bun's global root here)                 | remove the entry from the global manifest          |
| 4   | `rm -rf node_modules/hacker-install-ts` didn't stick                      | the dependency was still declared in `~/package.json`                                 | edit the manifest, not just the tree               |
| 5   | `hi --version` showed `0.1.0` after a version bump                        | `dist/npm/index.js` predated the bump; VERSION is baked at build time                 | `bun run build:npm` before installing              |
| 6   | `bun add -g "$PWD"` "worked" but copied the repo and left stale artefacts | local-path installs copy, they don't link                                             | prefer `bun link` for a dev loop                   |
| 7   | Old Python config was silently ignored                                    | TS only reads flat camelCase; the nested `config` object looked like "missing fields" | convert the file, and fail loudly on the old shape |
| 8   | Old state would have been silently wiped                                  | `parseToolState` tolerated the missing `tools` key as empty                           | explicit legacy-format error                       |
| 9   | Narrow-terminal `ls` wrapped into noise                                   | fixed six-column table with borders                                                   | width-aware borderless renderer                    |
| 10  | Candidate 40-col layout rendered `· VS Cod…`                              | truncation applied to a segment that had almost no room                               | drop the description below a minimum width         |

## Lessons learnt

1. **Relative specs for global installs are a trap in Bun 1.4.3.** Reproduce a package-manager
   failure with a minimal project before blaming the repo.
2. **Know where the global root is.** With a `~/package.json`, Bun uses `$HOME` as the global
   install root; `bun pm ls -g` and `bun pm bin -g` tell you in one line.
3. **Cleanup means manifest + lockfile + tree.** `bun install` faithfully re-creates anything
   still declared. Editing `node_modules` alone is wasted work.
4. **A `bin` that points into `dist/` is a build contract.** The linked CLI is only as current
   as the last `bun run build:npm`; version strings are compiled in.
5. **Config path + schema is a contract.** Two implementations sharing a path with different
   shapes silently fall back to defaults. Detect the old shape and refuse, rather than
   guessing or overwriting.
6. **Migrate data before deleting the migration tooling**, and keep the backup outside the
   temp dir if it matters.
7. **Terminal output is a UI, not a log.** Lists should be width-aware, scannable, colour-coded
   by meaning, and byte-stable when piped.
8. **Prioritise, then truncate.** Dropping a whole low-priority column reads better than
   half a word in every row.
9. **Colour must never carry meaning alone.** The hold state is both yellow and the word
   `held`, so it survives `NO_COLOR` and pipes.

## Verification

```bash
bun run check          # biome + tsc clean
bun test               # 129 pass, 301 assertions
bun run build:npm      # rebuilt dist/npm/index.js

hi config              # loads ~/.config/hacker/hacker-install/config.jsonc
hi state               # prints migrated {version, tools} state
hi ls                  # new width-aware list (verified through a pty)
hi ls --json           # unchanged keys for scripts
hi ls --hold           # "No tools are kept on hold"
```

Legacy guards were verified with `HI_CONFIG_DIR` / `HI_STATE_DIR` pointed at copies of the
old Python files; both produced the intended errors.

## Follow-ups

- `hi info`, the `hi get` selection summary, and the `hi pull` confirmation still use
  `cli-table3`; they will wrap in narrow terminals too.
- `hi completion` still writes to `~/.local/share/hacker-install-ts/completions`; renaming it
  requires re-running `hi completion --install` and fixing the marker line in the rc file.
- No `keepArchives` / `linkMode` for single-binary releases (keep the `.tgz`, symlink instead
  of copy).
- Package identity still carries the `-ts` suffix (npm name, release assets, user agent).
- Backups from this session live in a temp directory; move them somewhere durable if the old
  Python state is still wanted.
