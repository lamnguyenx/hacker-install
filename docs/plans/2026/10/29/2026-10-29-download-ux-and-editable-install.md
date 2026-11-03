# Plan: Download UX, text previews, editable install, and docs split (2026-10-29)

Status: done
Scope: fix the `hi get` experience end to end — progress bar, install previews, and downloads;
make `hi get` idempotent; document a live (editable) install; then split the growing README
into topic docs under `docs/important/`.

## Context

Installing `code-server` 4.143.1 (219 MB) exposed three problems at once:

- the progress bar printed a new, half-drawn line for every update;
- the install preview and asset picker used `cli-table3` box tables, which are noisy and wrap
  badly;
- the download used a single HTTP stream (~93 KB/s at the start) with no aria2c support.

The requests were: a unified bar, text-based previews with bold/italic/underline, and aria2c
with at least 8 parallel connections plus resume. A later pass added: do not reinstall a tool
that is already current, and an editable install workflow.

## 1. Progress bar

### First failure: lines wider than the terminal

The bar was composed as `label + 24-column bar + percent + amount + speed + ETA`, regardless of
terminal width. On an 80–113 column terminal the line wrapped; `\r\x1b[2K` cleared only the last
visual row, so each update left the first row behind:

```text
Downloading code-server-4.143.1-linux-amd64.tar.gz ━───────────────────────
Downloading code-server-4.143.1-linux-amd64.tar.gz ━───────────────────────
...                                                    3% 5.6 MB/219 MB 93 KB/s ETA 39:03
```

Fix: compose against the terminal width, read fresh on every frame. When space runs out, drop
detail in this order: ETA → speed → shrink the bar (minimum 8 columns) → middle-ellipsize the
label. Also added an 80 ms throttle and skip identical frames.

### Second failure: `columns` is still one column too many

The clamp allowed lines of exactly `columns` characters. Writing the last column makes the
terminal wrap to a new row; the next `\r\x1b[2K` then clears the _new_ row, leaving the full
previous frame on screen. The user's follow-up run showed four complete 100% lines.

Fix: keep every line **strictly narrower** than the terminal (`columns - 1`). Tests now assert
`line.length < width`, not `<= width`.

That was not the end of it. A later report still showed one complete frame per line while the
frames were only ~83 columns wide. The decisive clue: terminal line wrapping is _soft_ — copying
a wrapped line yields the original single line with no newline characters. The pasted output had
real newline characters between frames, so the frames were separated by something converting
`\r` to `\n` (a pty wrapper or log renderer), not by wrapping.

### Final protocol: do not depend on `\r`

`src/ui/progress.ts` now writes each frame followed by `\n`, and the next frame starts with
`ESC[1A` + `ESC[2K` (cursor up one row, erase line) before redrawing. `finish()` erases the line
the same way. This works on normal terminals and on anything that treats `\r` as a line break;
ANSI cursor movement is the part every renderer interprets consistently.

Also: draw the 100% frame exactly once. A download can sit at full size while aria2c finalises,
and the size poller used to keep redrawing with a falling speed (16 → 11 → 8.5 → 6.8 MB/s in the
report). Once `downloaded >= total`, further updates are ignored, and the aria2c poller stops
stat-ing the file at full size.

Verified in a real 113-column pty: frames 111–112 columns, three cursor-up redraws, zero `\r`
dependence.

## 2. Text previews instead of box tables

`cli-table3` rendered the install preview, asset list, "did you mean", `hi info`, and the
"tools to be installed" confirmation as bordered boxes. Replaced `src/ui/table.ts` with a plain
text renderer and removed the dependency (`bun.lock` lost 15 lines).

- **Single row → vertical field list**: `hi get`'s preview and `hi info` become a key–value
  card, so long filenames/URLs stay complete.
- **Several rows → aligned columns**: bold + underlined header, no borders, space alignment.
- **Emphasis**: title bold + underline; keys bold and coloured; values coloured; free text over
  44 columns italic.
- **Width**: only non-final columns truncate (with `…`) at 44 columns; ANSI-aware padding keeps
  alignment when styled.
- Piped/`NO_COLOR` output stays plain text, same information.

The first review pass produced exactly the shape requested: `Name / Selected Item / Version /
Size Mb / Downloads` stacked vertically under `🚀 Install: code-server`, and a borderless
`Asset ID / Filename / Size (MB) / Downloads` list above it.

## 3. aria2c downloads

`src/download.ts` now prefers `aria2c` when the probe succeeds:

```text
--continue=true --allow-overwrite=true --auto-file-renaming=false
--max-connection-per-server=8 --split=8 --min-split-size=1M
--file-allocation=none --console-log-level=warn --summary-interval=0
--download-result=hide --show-console-readout=false --user-agent=hacker-install
```

- Connections default to 8 and are clamped to 1–16; `connections` is an option in code.
- aria2c runs quietly; the CLI polls the output file size every 120 ms and drives its own bar.
  A size probe (`Range: bytes=0-0`, parse `Content-Range`) supplies the percentage denominator.
- On non-zero exit, empty file, or a short file, the built-in downloader takes over from the
  bytes already on disk (`Range: bytes=N-`). The same fallback runs when aria2c is absent.
- Probe detection requires `aria2` in `aria2c --version` stdout. Without that check, the test
  suite's `FakeExec` (which answers 0 to everything) would look like aria2c and bypass the fake
  HTTP server. A test asserts the pretend-binary case falls through to HTTP.
- Real-world check: downloaded `jq-linux-amd64` (2,319,424 bytes) from GitHub, truncated it to
  half, re-ran the download, and got the original size and bytes back.

## 4. Idempotent `hi get`

Rerunning `hi get <same repo>` after a successful install re-downloaded the release and asked
for confirmation again. The provider now stops before prompting when all of these match:

- same source URL and same release tag;
- same selected asset filename;
- same install mode (binary/bundle vs package);
- the install-path entry still exists (a symlink target must still resolve for bundles).

It logs `INFO <tool> <tag> is already installed (use --force to reinstall)`. `-F/--force`
bypasses the check; package installs are trusted from state because their files live outside
`installPath`. This covers the Git providers (GitHub/GitLab/Codeberg/Forgejo); mise and Docker
still reinstall on every `hi get`.

## 5. Editable install (`pip install -e` equivalent)

The user's attempt was `bun install -g ./ -e`. Findings:

- `-e` is not a Bun flag. Bun 1.4.2 errors with `Invalid Argument '-e'` (Bun's `-E` is
  `--exact`, unrelated).
- A relative path is worse than invalid: `bun install -g .` fails with `refusing to install
  dependency with unsafe name`, installs a package named `@`, and writes a junk `"" : "."` entry
  into `~/.bun/install/global/package.json`. The entry was removed and the global lockfile
  reconciled.
- An absolute path (`bun install -g "$PWD"`) links the package folder; `bun link` does the same.
  But `package.json` points `hi` at `./dist/npm/index.js`, a generated bundle. A fresh checkout
  has no `dist/`, so Bun silently creates no `hi` command; after a build, edits to `src/` still
  require a rebuild. Linked installs are therefore not editable.
- The working recipe is a launcher at `~/.bun/bin/hi`:

  ```sh
  #!/bin/sh
  exec /home/<user>/.bun/bin/bun /home/<user>/git/hacker-install/src/index.ts "$@"
  ```

  It runs the checkout directly (new files included), needs no rebuild, and is reverted with
  `rm ~/.bun/bin/hi && bun install -g hacker-install`. Documented in
  [Local development](../../../../important/development/local-setup.md).

### Incident: writing through the old symlink

`~/.bun/bin/hi` was a symlink into the global npm install. Writing the wrapper to that path
followed the link and overwrote the **published bundle** with the 3-line script — and because
Bun's cache used a hard link, the corrupted inode was also in the cache, so a forced reinstall
restored the wrapper instead of the package.

Recovery: downloaded the published `hacker-install-2026.10.29.tgz` from the npm registry,
restored `dist/npm/index.js` (309,978 bytes, verified `#!/usr/bin/env bun`), deleted the
`hacker-install@2026.10.29@@@1` cache entry and its symlink, then removed and recreated the bin
as a **regular file**. Lesson: `rm` a symlink before writing a file at the same path.

## 6. Docs split

Inventory before the change: README 667 lines with its own table of contents; 4 topic docs plus
a per-directory index in `docs/important/`; 3 dated plans. The README carried installation,
provider, management, configuration, development, and release material inline.

Topic map (README ranges → docs):

| README section                 | Destination                                             |
| ------------------------------ | ------------------------------------------------------- |
| Getting started + Requirements | `getting-started/installation.md`                       |
| Commands + completion          | `cli/commands.md`                                       |
| GitHub/GitLab/Codeberg         | `install/git-providers.md`                              |
| System packages                | `install/packages.md`                                   |
| mise/aqua                      | `install/mise-aqua.md`                                  |
| Docker                         | `install/docker.md`                                     |
| Asset selection                | `install/asset-selection.md`                            |
| Manage installed tools         | `manage/installed-tools.md`                             |
| `hi pull`                      | `manage/state-sync.md`                                  |
| Configuration                  | `configuration/configuring.md`                          |
| Python migration               | `getting-started/migration-from-python.md`              |
| Development                    | `development/local-setup.md`                            |
| Release assets                 | `development/release-assets.md`                         |
| Table of contents              | dropped — the README docs index is the only index       |
| Config and state format        | dropped — duplicated `configuration/files-and-paths.md` |
| Versioning and releases        | dropped — covered by `development/releasing.md`         |
| Docs                           | replaced by the README docs index                       |

Moves kept filenames: `cli-output-style.md` → `cli/`, `files-and-paths.md` →
`configuration/`, `install-flow.md` → `install/`, `releasing.md` → `development/`. The
per-directory `docs/important/README.md` was deleted: one index (the root README), not two.

Docs were carved from README line ranges by a script with assertions on the first heading and
refusal to overwrite existing files; headings outside code fences were demoted one level. Links
were updated by resolving targets, not by matching names: `./install-flow.md` →
`../install/install-flow.md`, `../plans/` → `../../plans/`, `#provider-tokens` →
`../configuration/configuring.md#provider-tokens`.

Stale content was corrected in place: the local-clone note now points at the editable install,
the output-style doc describes the text renderer and the new progress protocol, the install-flow
doc has a Downloads section, and `hi get`'s `-F/--force` is documented.

## Errors, trials and dead ends

| #   | Symptom                                               | Root cause                                                            | Fix                                                             |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | 13 repeated half-bars at 3%                           | bar wider than the terminal; `\r` clears only the wrapped row         | compose to terminal width; drop detail before shrinking the bar |
| 2   | 4 complete frames, one per line, at 100%              | clamp allowed `columns` exactly; writing the last column wraps        | clamp to `columns - 1`                                          |
| 3   | still one frame per line after the width fix          | pty/renderer translates `\r` to `\n`; copied frames had real newlines | newline-terminated frames + `ESC[1A` `ESC[2K` redraw            |
| 4   | 100% redrawn with falling speed (16 → 6.8 MB/s)       | aria2c finalising while the size poller kept drawing                  | draw 100% once; poller stops at full size                       |
| 5   | width test passed but the bar still misbehaved        | test asserted `<= width`, the failing case is exactly `== width`      | assert `< width`                                                |
| 6   | aria2 path hijacked the test suite                    | `FakeExec` answers 0 to everything, including `aria2c --version`      | require `aria2` in the version output to consider it installed  |
| 7   | aria2c printed `[#...]` readout mid-bar               | `--summary-interval=0` and `--download-result=hide` were not enough   | add `--show-console-readout=false`                              |
| 8   | `bun install -g ./ -e` failed                         | `-e` is a pip flag, not a Bun flag; relative specs are unsafe         | `bun link` or an absolute path; launcher for editable installs  |
| 9   | `bun link` produced no `hi` command                   | bin points at `dist/npm/index.js`, missing before the first build     | build once; or run `src/index.ts` through a wrapper             |
| 10  | reinstall restored the wrapper instead of the package | the global bundle and Bun's cache shared the corrupted inode          | restore from the npm tarball; delete the cache entry            |
| 11  | `hi get` re-downloaded after a successful install     | no up-to-date check before the prompt                                 | compare source/tag/asset/mode/existing link; add `-F/--force`   |
| 12  | empty-name `@` package in `bun pm ls -g`              | failed relative global install registered a package named `@`         | delete `"" : "."` from the global manifest and reinstall        |

## Lessons learnt

1. **Width is a hard boundary with an off-by-one.** Knowing `columns` is not enough; never write
   the last column, and test the boundary, not just "fits".
2. **Terminal line wrapping is soft; newlines in copied output are real.** When frames appear as
   separate complete lines, something converted `\r` to `\n` — stop using `\r`.
3. **Progress output needs a protocol, not a string.** Newline + cursor-up is the only redraw
   that survives pty wrappers, log renderers, and resizes.
4. **A download can be "complete" before the tool exits.** Freeze the 100% frame and stop
   polling; otherwise the bar reports a decaying speed at the finish line.
5. **Prefers links over copies for local installs, but check the bin target.** A linked package
   whose bin points at a built artifact is not editable.
6. **Writing through a symlink can destroy the target.** Remove the link first; verify with
   `ls -la` before writing into a bin directory.
7. **Fake executors need a signature check.** A probe that only checks the exit code will match
   any fake; require a recognizable version string.
8. **Keep downloads resumable at every layer.** aria2c resumes with `--continue`; the fallback
   resumes with `Range` from the same partial file.
9. **Idempotency is part of the install UX.** `hi get` on a current tool should be a no-op with
   an explicit message, and `--force` should be the escape hatch.
10. **Move docs by line range, not by retyping.** Carving with assertions preserved sentences
    that a manual copy would have dropped.
11. **Relink by resolving paths, not by matching basenames.** The same filename can exist in
    several topics and plans; only links that resolve to a moved file should change.
12. **One index.** Deleting the per-directory index removed a list that would have drifted from
    the README docs index.

## Verification

```bash
bun run check                  # biome + tsc clean
bun test                       # 146 pass, 377 assertions
bunx biome check src/ test/    # no fixes
```

Download check (real network):

```bash
# jq-linux-amd64, 2,319,424 bytes; aria2 1.36.0
# full download -> truncate to half -> download again -> size and bytes match
```

Progress check (real 113-column pty): frames 111–112 columns, one 100% frame, cursor-up
redraws, no `\r` dependency.

Docs checks:

```bash
# every doc is linked from the README
for f in $(find docs/important -name '*.md'); do
  grep -q "($f)\|($f#" README.md || echo "NOT INDEXED: $f"
done

# every relative link and README anchor resolves (small resolver script, not committed)
```

## Follow-ups

- Add the docs coverage/link/anchor check to CI; it is three small scripts and catches drift.
- Extend the up-to-date short-circuit to mise and Docker installs.
- Consider surfacing a hint when aria2c is not installed (`apt install aria2`), without making
  it a hard dependency.
- `hi get` currently re-checks the latest release even when the tool is current; that is
  intentional (cheap API call) but could be cached for offline use.
- The npm global bundle was briefly corrupted during setup; verify `bun pm ls -g` on other
  machines if a wrapper was ever written through the bin symlink.
