# Plan: Local installs, editable `hi`, and the install path (2026-11-03)

Status: done
Scope: make a checkout installable as the global `hi`, add an editable install target, and
explain why tools landed in `~/bin` instead of `~/.local/bin`.

## Goals

1. Make `bun add -g ./` from a clean checkout produce a working `hi` command.
2. Add `make install-e` so source edits take effect without rebuilding or reinstalling.
3. Keep the built/npm install path working alongside the editable one.
4. Document the `installPath` default and its relationship with `PATH`.

## 1. `hi` was installed but the command did not exist

The starting point was a clean checkout and a global install that looked successful:

```console
$ bun add -g ./
bun add v1.4.4 (38afee6c8)

installed hacker-install@../../../git/hacker-install with binaries:
 - hi

[4.00ms] done

warn: To run "hi", add the global bin folder to $PATH:

export PATH="/home/lamnt45/.bun/bin:$PATH"
```

Adding that directory to `PATH` did not help:

```console
$ export PATH="/home/lamnt45/.bun/bin:$PATH"
$ hi
Command 'hi' not found, but can be installed with:
snap install hi
```

The global package was present, but the bin directory contained only Bun and an unrelated
tool:

```console
$ ls -la ~/.bun/bin/
bun
bunx -> /home/lamnt45/.bun/bin/bun
mdts2 -> ../install/global/node_modules/@lamnguyenx/mdts2/bin/mdts
```

The installed package had no npm bundle:

```console
$ ls -la ~/.bun/install/global/node_modules/hacker-install/dist/npm/
total 8
drwxr-xr-x 2 lamnt45 lamnt45 4096 Nov  3 15:06 .
drwxr-xr-x 3 lamnt45 lamnt45 4096 Nov  3 15:06 ..
```

Root cause: `package.json` exposes the command as `./dist/npm/index.js`:

```json
"bin": {
  "hi": "./dist/npm/index.js"
}
```

`dist/` is gitignored, so a clean checkout has no `dist/npm/index.js` until `bun run
build:npm` runs. Bun installs the package and prints "with binaries: hi", but silently skips
creating `~/.bun/bin/hi` when the target does not exist. The PATH warning is unconditional
and misleading: the command was missing because there was no symlink, not because the
directory was missing from `PATH`.

This reproduced in an isolated Bun prefix with a deliberately missing bin target:

```bash
BUN_INSTALL=/tmp/probe bun add -g ./
# prints the "add the global bin folder to $PATH" warning for the missing command,
# but /tmp/probe/bin stays empty
```

## 2. The first rebuild failed: dependencies were missing

With the root cause known, the next step was to build the bundle:

```console
$ bun run build:npm
$ bun run scripts/build.ts --npm
Building npm bundle...
1 | import { Command, CommanderError } from "commander";
                                            ^
error: Could not resolve: "commander". Maybe you need to "bun install"?
```

The global install had its own dependency tree under `~/.bun/install/global/node_modules`,
but the checkout had no local `node_modules`. The fix was to install the repo dependencies
first, then build, then reinstall globally:

```bash
bun install
bun run build:npm
bun add -g ./
hi --version
# 2026.10.29
```

After this, `~/.bun/bin/hi` existed:

```console
$ ls -l ~/.bun/bin/hi
hi -> ../install/global/node_modules/hacker-install/dist/npm/index.js
```

## 3. Editable install: `make install-e`

`bun add -g ./` is copy/hardlink based. The installed files shared inodes with the checkout:

```console
$ stat -c '%i %h %n' dist/npm/index.js \
    ~/.bun/install/global/node_modules/hacker-install/dist/npm/index.js
77765373 2 dist/npm/index.js
77765373 2 /home/lamnt45/.bun/install/global/node_modules/hacker-install/dist/npm/index.js
```

That makes a local install feel editable, but rebuilds and editors that replace files can
break the link. A deliberate editable install needs a symlinked package and a bin that runs
the source.

`bun link` supplies the symlink:

```console
$ bun link
Success! Registered "hacker-install"

$ ls -ld ~/.bun/install/global/node_modules/hacker-install
... hacker-install -> /home/lamnt45/git/hacker-install
```

The package still exposes `dist/npm/index.js`, so a built bundle would still require a
rebuild. The Makefile target writes a tiny launcher at that path and registers the package:

```make
.PHONY: install-e

# Editable global install: registers this checkout with `bun link` and points
# the `hi` binary at src/index.ts, so source edits take effect immediately.
install-e:
	bun install
	mkdir -p dist/npm
	printf '#!/usr/bin/env bun\nimport "../../src/index.ts";\n' > dist/npm/index.js
	chmod +x dist/npm/index.js
	bun link
```

Flow:

```text
~/.bun/bin/hi
    -> ~/.bun/install/global/node_modules/hacker-install   (symlink)
        -> /path/to/checkout                               (bun link)
            -> dist/npm/index.js                           (dev launcher)
                -> src/index.ts                            (executed by Bun)
```

Editable mode was verified by appending a temporary line to `src/index.ts`, running `hi`
without rebuilding, and restoring the file:

```console
$ hi --version
2026.10.29
editable-ok
$ git diff --stat src/index.ts
# clean after restore
```

The target was also tested from a state where both links had been deleted:

```bash
rm -rf ~/.bun/install/global/node_modules/hacker-install ~/.bun/bin/hi
make install-e
hi --version   # 2026.10.29
```

`bun link` recreated both the package symlink and the bin symlink.

Caveats:

- `bun run build:npm` overwrites the launcher with the real bundle. Run `make install-e`
  again to return to editable mode.
- `bun link` stores an absolute path. Moving the checkout requires re-running
  `make install-e`.

## 4. Install path: `~/bin` vs `~/.local/bin`

An install of k9s reported:

```text
INFO     install /home/lamnt45/Downloads2/dn_k9s_80a19932de1c/k9s /home/lamnt45/bin/k9s
INFO     Installed: k9s
```

That is the configured path, not a bug in the install helper. The config file contained:

```jsonc
// ~/.config/hacker/hacker-install/config.jsonc
"installPath": "~/bin",
```

`defaultConfig()` also uses `~/bin` (`src/schemas.ts`). The `~/.local/bin` example in the
README is an alternative, not the default.

The problem was that `~/bin` was not on `PATH`:

```console
$ printf '%s\n' "$PATH" | tr ':' '\n' | grep -E '/(bin|\.local/bin)$'
/home/lamnt45/.bun/bin
/home/lamnt45/.local/bin
/home/lamnt45/.opencode/bin
...
```

So k9s was installed into a directory the shell never searches. The fix was to switch the
config and move the existing binary rather than re-downloading 39 MB:

```bash
hi config --path ~/.local/bin
mkdir -p ~/.local/bin
mv ~/bin/k9s ~/.local/bin/k9s
rmdir ~/bin
command -v k9s
# /home/lamnt45/.local/bin/k9s
k9s version
# Version: v0.51.0
```

Because `~` was unquoted, the shell expanded it before `hi` saw the argument, so the config
stored `/home/lamnt45/.local/bin`. That works. To keep the literal tilde in the file, quote
the path:

```bash
hi config --path '~/.local/bin'
```

`installPath` is not stored in `state.json`; state only records tool metadata. Moving a
binary by hand is safe as long as `hi` looks for it under the new configured directory.

## Errors, trials and dead ends

| #   | Symptom                                                                 | Root cause                                                               | Fix                                                               |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 1   | `bun add -g ./` reported `binaries: hi`, but `hi` was command-not-found | `dist/npm/index.js` did not exist; Bun silently skipped the bin link     | `bun run build:npm` before installing                             |
| 2   | Exporting `~/.bun/bin` did not fix `hi`                                 | There was no `hi` symlink to find; this was not a PATH problem           | inspect `~/.bun/bin` and the manifest's `bin` target              |
| 3   | `bun run build:npm` failed with `Could not resolve: "commander"`        | The checkout had no local `node_modules`                                 | `bun install` first                                               |
| 4   | `bun link` alone still required a rebuild after source changes          | The `bin` entry points at the built bundle at `dist/npm/index.js`        | write a dev launcher that imports `src/index.ts`, then `bun link` |
| 5   | `hi get k9s` wrote to `~/bin`                                           | `defaultConfig()` and the existing config both use `~/bin`               | `hi config --path <dir>` and move or reinstall existing tools     |
| 6   | k9s was installed but not runnable                                      | `~/bin` is not on this machine's `PATH`                                  | install to `~/.local/bin`, which is on `PATH`                     |
| 7   | Config stored an absolute path instead of `~/...`                       | The shell expanded unquoted `~` before `hi` received the argument        | quote `'~/.local/bin'` when the literal form matters              |
| 8   | README claimed `bun add -g .` was broken in Bun 1.4.3                   | Bun 1.4.4 handles both `.` and `./` in an isolated prefix                | update the note; the real failure mode is a missing `bin` target  |
| 9   | Bun printed a PATH warning even though it created no bin link           | The warning is emitted for declared binaries regardless of link creation | check `command -v hi` or `ls ~/.bun/bin`, not just the warning    |

## Lessons learnt

1. **"Installed with binaries" does not mean the command exists.** Verify with
   `command -v hi` or `ls -l ~/.bun/bin/hi`.
2. **Bun's PATH warning is unconditional.** It can suggest a PATH fix when the real problem
   is a missing or unbuilt bin target.
3. **Gitignored build output makes a clean checkout non-installable.** `dist/npm/index.js`
   must be built before `bun add -g ./`, or replaced with a source launcher.
4. **A global install has its own dependency tree.** It does not make `node_modules`
   available to the checkout, so `bun install` is still required before building.
5. **`bun link` is the right primitive for editable installs, but it follows the manifest.**
   Linking the package is not enough when `bin` points at a generated bundle; the bin target
   must also point at source.
6. **Editable mode needs an explicit boundary.** Building the real npm bundle overwrites the
   dev launcher; `make install-e` restores it.
7. **Defaults deserve skepticism.** `~/bin` is a valid default, but it is not universally on
   `PATH`; a configured install path that the shell cannot see produces a silent usability
   bug.
8. **State is metadata, not a file map.** Changing `installPath` does not move existing
   binaries; move them or reinstall.
9. **Quote `~` when passing it through a shell.** Unquoted, the shell resolves it before the
   CLI can persist the portable form.
10. **Probe global installer behavior in an isolated `BUN_INSTALL` prefix.** It is the fastest
    way to distinguish a Bun bug from a local checkout problem without modifying the real
    global install.

## Verification

```bash
bun install
bun run build:npm
bun add -g ./
hi --version                    # 2026.10.29

make install-e
hi --version                    # 2026.10.29
ls -l ~/.bun/bin/hi             # -> .../hacker-install/dist/npm/index.js
readlink -f ~/.bun/install/global/node_modules/hacker-install
# /home/lamnt45/git/hacker-install

hi config --path '~/.local/bin'
command -v k9s                  # /home/lamnt45/.local/bin/k9s
k9s version                     # v0.51.0
```

## Follow-ups

- Consider changing `defaultConfig().installPath` to `~/.local/bin`. It is more likely to be
  on `PATH` on modern Linux, but it changes behaviour for new users and needs README, docs,
  and test updates.
- Consider warning in `hi get` when `installPath` is not on `PATH`.
- Add `make install` (non-editable) and `make uninstall-e` targets so switching between
  bundled and editable installs does not require remembering the Bun commands.
