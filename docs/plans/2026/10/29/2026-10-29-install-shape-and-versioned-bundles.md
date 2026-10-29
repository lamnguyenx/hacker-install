# Plan: Install-shape output and versioned bundles (2026-10-29)

Status: done
Scope: make `hi ls` / `hi info` report how a tool is actually installed, show symlink
targets, keep the version in bundle paths, and render long link targets on 80-column
terminals.

## Context

`hi ls` reported code-server as a plain binary:

```text
Installed tools (1)

  code-server · v4.143.1 · binary · github
  github.com/coder/code-server · VS Code in the browser
```

But code-server is a directory bundle:

```text
~/.local/bin/code-server -> ~/Downloads2/code-server/bin/code-server
```

The state file also says `installMethod: "binary"`, which is true in the sense that the
provider installed a release asset rather than a system package. It says nothing about the
on-disk shape: copied file, directory bundle, or symlink. The list renderer hardcoded
everything non-package to `binary`:

```ts
type: isPackageTool(tool) ? tool.packageType : "binary";
```

The request was: show the symlink, show its original location, and label the install as a
bundle. A follow-up noticed that the target itself lost the release version because bundles
were flattened into `bundlePath/<name>`. The target should look like:

```text
~/Downloads2/code-server/code-server-4.143.1-linux-amd64/bin/code-server
```

## 1. Report the on-disk install shape in `hi ls`

`src/app/manage.ts` now derives the shape from the install path instead of guessing from
state. Package installs still use the recorded package type; everything else is inspected:

```ts
const link = join(ctx.installPath, tool.name);
const rawTarget = await readlinkOrNull(link);
if (rawTarget === null) return { type: "binary" };

const target = isAbsolute(rawTarget) ? rawTarget : resolve(dirname(link), rawTarget);
const bundle = join(resolve(ctx.bundlePath), tool.name);
const isBundle = target === bundle || target.startsWith(`${bundle}${sep}`);
return { type: isBundle ? "bundle" : "symlink", symlink: { path: link, target } };
```

Resulting types:

| Type                       | Detection                                                |
| -------------------------- | -------------------------------------------------------- |
| `deb` / `rpm` / `AppImage` | `installMethod === "package"`; recorded in state         |
| `bundle`                   | install-path entry is a symlink into `bundlePath/<name>` |
| `symlink`                  | install-path entry is any other symlink                  |
| `binary`                   | install-path entry is a real file, or missing            |

`hi ls --json` remains additive: the existing keys are unchanged, and symlink installs gain
`"symlink": { "path": "...", "target": "..." }`.

## 2. Report the same shape in `hi info`

`hi info` used to print only `Name`, `Description`, and `Source`. It now shares the same
`installInfo()` probe and adds:

```text
Info: code-server

  Name         code-server
  Description  VS Code in the browser
  Source       https://github.com/coder/code-server
  Type         bundle
  Symlink      /home/you/.local/bin/code-server
  Target       /home/you/Downloads2/code-server/code-server-4.143.1-linux-amd64/bin/code-server
```

`listInstalled` and `getInfo` became async because `readlink` / `realpath` are async. The
Commander actions and the tests await them.

## 3. Keep the link and target visible at 80 columns

The first list output put the link and target on one line:

```text
  /Users/lamnt45/.local/bin/code-server -> /Users/lamnt45/Downloads2/code-se…
```

At 80 columns the destination was cut off, which defeats the point. The renderer now:

1. Prints `link -> target` on one line when it fits.
2. Otherwise prints the link and `-> target` on separate lines.
3. If the target still does not fit, wraps it at `/` boundaries with a three-space
   continuation, so the whole destination survives.

```text
  /Users/lamnt45/.local/bin/code-server
  -> /Users/lamnt45/Downloads2/code-server/code-server-4.143.1-linux-amd64/
     bin/code-server
```

A first wrapping pass produced an orphaned `code-server` on its own line. When the tail after
a break is shorter than 12 columns, the wrapper moves the break to the previous `/`.

Paths are shortened to `~` when they are under `$HOME`. When they are not (for example a
migrated config pointing at `/Users/...` while `$HOME` is `/home/...`), the absolute path is
printed unchanged.

## 4. Keep the version in bundle paths

`installBundle` used to flatten the extracted package directory: it moved the children of
`<temp>/code-server-4.143.1-linux-amd64` directly into `bundlePath/code-server`, losing the
version and platform. The layout is now:

```text
bundlePath/<name>/<version-dir>/
        └── bin/<name>

installPath/<name> ──symlink──▶ bundlePath/<name>/<version-dir>/bin/<name>
```

`<version-dir>` is chosen in this order:

1. The archive's top-level extracted folder, when it contains the release version
   (`code-server-4.143.1-linux-amd64`).
2. The release tag, when the archive extracts straight to the root or the folder is just the
   tool name (`v4.143.1`).
3. The release tag appended to the extracted folder when the folder does not contain the
   version (`code-server-linux-amd64-v4.143.1`).

Providers pass the tag into `installBin()`: Git uses `release.tagName`, mise uses
`candidate.version`. `findBundlePackageDir()` returns the directory containing `bin/<name>`
instead of only the launcher path.

Release data is remote input, so every path segment goes through `safeDirName()`: only
`[A-Za-z0-9._-]` survives, leading dots/dashes are stripped, and an empty result becomes
`current`.

Upgrades still remove the whole `bundlePath/<name>` root before moving the new tree in, so
only the current version is kept. Removal already checks that the link target is inside
`bundlePath/<name>`, which continues to work with the extra version level.

Existing flat installs are not migrated automatically: the old target is still valid, and
moving a bundle that a running process may be using is riskier than a reinstall. Re-run:

```bash
hi get https://github.com/coder/code-server --force
```

## Errors, trials and dead ends

| #   | Symptom                                                              | Root cause                                                        | Fix                                                             |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | `hi ls` called code-server a `binary`                                | non-package type was hardcoded; state only records binary/package | inspect `installPath/<name>` with `readlink` and classify       |
| 2   | link target shown as `code-se…` at 80 columns                        | link and target packed on one line                                | split into `link` and `-> target` lines                         |
| 3   | versioned target still truncated after the split                     | a single target line exceeded 80                                  | wrap at `/` with a continuation indent                          |
| 4   | continuation line contained only `code-server`                       | greedy break left a tiny tail                                     | break one `/` earlier when the tail is under 12 columns         |
| 5   | `hi info` had no type, link, or target                               | it only rendered Name/Description/Source                          | share `installInfo()` and add `Type`, `Symlink`, `Target`       |
| 6   | bundle path lost the version                                         | `installBundle` moved the children of the extracted package dir   | move the package dir under `bundlePath/<name>/<version-dir>`    |
| 7   | root-extracted archives would use `dn_<repo>_<hex>` as a version dir | `packageDir` equals the per-install temp dir                      | detect `resolve(packageDir) === resolve(src)` and use the tag   |
| 8   | extracted folder can exist without a version                         | folder name was used unconditionally                              | append the release tag when it is missing                       |
| 9   | release tag could contain `/` or `..`                                | remote tag was joined directly into a filesystem path             | sanitize every version-dir segment with `safeDirName()`         |
| 10  | `tsc` could not find `resolve`                                       | `node:path` import was not extended                               | add `resolve`                                                   |
| 11  | mise compile error: `asset` is not defined                           | `install()` parameter is named `candidate`                        | pass `candidate.version`                                        |
| 12  | bundle tests expected the old flat paths                             | assertions encoded `bundlePath/<name>/bin/<name>`                 | update paths and add root-level / tag-fallback / wrapping cases |
| 13  | `~` shortening did not fire on this machine                          | config points at `/Users/...`, `$HOME` is `/home/...`             | fall back to the absolute path; do not assume `$HOME` prefixes  |
| 14  | existing code-server still shows the old target                      | layout changes are forward-only; the old link is still valid      | reinstall with `--force`; documented in the plan and docs       |

## Lessons learnt

1. **State records intent; the filesystem records shape.** `installMethod: binary` does not
   mean "a flat file exists". For layout questions, inspect the install path.
2. **A list is a UI for the install, not a state dump.** Show `bundle` / `binary` / `symlink`
   and the link target; provider and version alone do not explain where the command runs.
3. **80 columns is the design target, and truncation at the end of a path is the wrong
   failure.** Split first, then wrap at path separators; never cut off the destination.
4. **Avoid orphaned tails when wrapping.** A one-word continuation looks like a bug; break at
   the previous separator when the remainder is tiny.
5. **A version belongs in the bundle path.** Preserve the archive's top-level folder instead
   of flattening it; when it has no version, append the release tag.
6. **Never trust release metadata as a path segment.** Sanitize tags and extracted names
   before joining them under `bundlePath`.
7. **Async probes ripple.** Making list/info read links forces the command actions and tests
   to become async. Make the command boundary async once rather than mixing sync wrappers.
8. **JSON contracts should grow, not change.** Keep the existing `hi ls --json` keys and add
   an optional `symlink` object.
9. **Layout changes are forward-only unless there is a migration story.** Old installs keep
   working; changing them needs an explicit reinstall or a repair command.

## Verification

```bash
bun run check   # biome + tsc clean
bun test        # 153 pass, 411 assertions
```

Manual checks:

```bash
hi info code-server
hi ls
COLUMNS=80 script -qec 'hi ls' /dev/null   # verify split/wrap at 80 columns
```

`test/bundle-install.test.ts` covers:

- extracted archive folder kept as the version dir;
- root-level bundle falling back to the release tag;
- an extracted folder without a version getting the tag appended;
- upgrade replacing the old version tree;
- removal through the symlinked bundle root.

`test/manage.test.ts` covers the bundle/symlink classification and both text and JSON output.
`test/list.test.ts` covers home shortening, the link/target split, and path wrapping at 80
columns.

The existing code-server install on this machine predates the layout change, so its link was
not rewritten during verification. The new layout is covered by the bundle-install tests and
takes effect on the next install or `--force` reinstall.

## Follow-ups

- Add a `hi repair` (or `hi migrate`) path that moves a flat bundle into
  `bundlePath/<name>/<tag>/` and recreates the symlink without re-downloading.
- Consider warning in `hi ls` / `hi info` when the install-path entry is a legacy flat bundle
  or when the link target is missing.
- Revisit retention now that bundles are versioned. The layout is ready for
  `bundlePath/<name>/<tag>/`, but `installBundle` still deletes the whole `<name>` root; see
  the [upgrade retention plan](../../10/26/2026-10-26-upgrade-version-retention.md).
- Add `hi info --json` if scripts need the same fields as `hi ls --json`.
- Add a docs sample check to CI so output snippets stay aligned with the renderer.
