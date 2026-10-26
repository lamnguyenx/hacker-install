# Plan: Upgrade retention and rollback (2026-10-26)

Status: draft — research and options, no code changes yet
Scope: decide whether `hi upgrade` should keep old versions or downloaded archives, and if so
how many / for how long. This document records current behaviour and comparable package
managers; it does not change the implementation.

## Current behaviour

`hi upgrade` does not retain anything:

| Artifact           | What happens                                                    | Source                                    |
| ------------------ | --------------------------------------------------------------- | ----------------------------------------- |
| Directory bundle   | `bundlePath/<name>` is deleted before the new tree is moved in  | `src/helper/install.ts` (`installBundle`) |
| Single binary      | `copyFile` overwrites `installPath/<name>` in place             | `src/helper/install.ts` (`installBinary`) |
| Downloaded archive | Temp dir `bundlePath/dn_<repo>_<rand>/` is removed in `finally` | `src/providers/git/main.ts` (`get`)       |
| State              | One `tagName` and one `assets` entry per tool; no history       | `src/schemas.ts`                          |

There is no archive cache and no previous-version directory. The only rollback path today is
to reinstall an old tag explicitly:

```bash
hi get https://github.com/coder/code-server -t v4.142.0
```

`-t/--tag` also sets `holdUpdate: true`, so the rolled-back version is not immediately
upgraded again. This works as long as the upstream release and asset still exist; it
re-downloads the release.

Package installs (`--pkg`) and Docker are outside this model: the OS package manager and
Docker own their old versions, and `hi` only records the current one.

Upgrades are also not atomic. `installBundle` removes `bundlePath/<name>` before moving the
new tree in, and `installBinary` overwrites the destination in place. A failure during the
move/copy can leave a partial install with no previous version to fall back to. A retained
version plus a `current` symlink would make the switch atomic as well as reversible.

### Archive lifecycle

The downloaded archive is always temporary:

1. `download()` writes `<bundlePath>/dn_<repo>_<rand>/<asset-name>`.
2. `extractUrl()` extracts into the same `dn_*` directory, so the archive and the extracted
   tree coexist while the install runs.
3. `installBin()` copies the single binary to `installPath`, or moves the package directory to
   `bundlePath/<name>`.
4. `finally` removes the entire `dn_*` directory, including the archive.

This happens whether the install succeeded or failed. There is no archive cache and no
cross-run resume: `download()` can resume within one attempt using HTTP `Range`, but a new
`hi get` creates a new `dn_*` directory. If the process is killed before `finally`, a stale
`dn_*` directory can remain; there is no startup sweep for those.

## What Homebrew does

Homebrew keeps the **current** version, not a rotation:

- `brew upgrade` installs the new keg, then runs `brew cleanup` for the upgraded formulae
  unless `HOMEBREW_NO_INSTALL_CLEANUP` is set.
- Cleanup removes older kegs but keeps the newest installed one. It also skips linked and
  pinned kegs.
- Cleanup is gated on `latest_version_installed?`. If the newest known formula version is not
  installed, Homebrew prints `Warning: Skipping <formula>: most recent version <x> not
  installed` and leaves **all** old kegs alone. This is why multiple versions can accumulate.
- A full cleanup across all formulae runs every 30 days
  (`HOMEBREW_CLEANUP_PERIODIC_FULL_DAYS`, default 30).
- Cached downloads older than 120 days are removed (`HOMEBREW_CLEANUP_MAX_AGE_DAYS`, default
  120).
- There is no built-in rollback. `brew switch` was removed. The documented path for an older
  version is `brew version-install <formula>@<version>` (which extracts it into a local tap)
  or `brew extract`.

Local evidence on this machine (Homebrew 7.0.10):

```text
$ brew list --versions ca-certificates python@3.12 squid
ca-certificates 2026-08-13 2026-05-14 2026-07-16 2026-03-19
python@3.12 3.12.5 3.12.6 3.12.14
squid 6.13 7.7

$ brew cleanup -n squid
Would remove: /opt/homebrew/Cellar/squid/6.13 (179 files, 8.8MB)

$ brew cleanup -n ca-certificates
Warning: Skipping ca-certificates: most recent version 2026-10-20 not installed
```

So the rule is "keep one, remove the rest", and old versions survive only when cleanup is
disabled, hasn't run, or the newest version is not installed. Homebrew does not rotate three
releases.

## What other tools do

| Tool             | Old versions after upgrade                          | Cleanup / retention                                                                      | Rollback                                                      |
| ---------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Homebrew         | Removed by `brew cleanup`, which runs after upgrade | Keep newest installed; cache 120 days; periodic full cleanup 30 days                     | No built-in; `brew version-install` / `brew extract`          |
| Scoop            | Kept until `scoop cleanup`                          | Removes all except `current`; `-k` also clears cache; no `--keep N` (open request #5382) | `scoop reset <app>@<version>` if the version dir still exists |
| mise             | Kept for a grace period, then pruned                | `upgrade.prune_after` (default 24h), `--prune` / `--no-prune`, `mise prune`              | Install/switch a specific version                             |
| asdf             | Kept until explicit uninstall                       | No automatic cleanup                                                                     | Switch versions / uninstall                                   |
| npm, cargo, pipx | Replaced in place                                   | Download cache only, not installed versions                                              | Reinstall the old version                                     |

The common pattern is not "keep N". It is:

1. install the new version,
2. keep the old one only until cleanup (immediate, grace period, or explicit command),
3. provide a deliberate way to install/switch an older version.

## Options for `hi`

### A. Keep zero versions (status quo, Homebrew-like)

Delete the old bundle/binary after a successful upgrade, as today.

- Pros: no schema or layout change, no disk growth, simple failure model.
- Cons: no instant rollback; `hi get -t <old>` needs network and a still-available asset.
- Fits: users who treat a bad upgrade as "reinstall the old tag".

### B. Keep one previous version for a grace period (mise-like)

After a successful upgrade, move the old install to a holding area
(`bundlePath/.trash/<name>-<tag>/` or a versioned directory) and prune it after a TTL
(for example 7 days) or on the next successful upgrade.

- Pros: fast rollback for the "new version broke my workflow" case; bounded disk; no
  long-term N growth.
- Cons: changes the install layout for single binaries (versioned file plus symlink);
  requires state history; doubles disk for large bundles while the previous version is held.
- Rollback: `hi rollback <name>` (switch the symlink back) or `hi get -t <tag>`.
- Cost example: `code-server` is 599 MB installed and 204 MB compressed; holding one previous
  install temporarily doubles the installed footprint.

### C. Keep N installed versions (for example 3)

Use a versioned layout (`installPath/.hi/versions/<name>/<tag>/` plus a `current` symlink, or
`bundlePath/<name>/<tag>/`), keep the last N, and expose `hi versions` / `hi rollback`.

- Pros: offline rollback and switching; predictable retention.
- Cons: largest change; `hi ls`, state, installers and removal all need history semantics;
  disk cost (3 × 599 MB for code-server); package installs cannot keep multiple system
  versions; Docker and mise already have their own version stores.
- This is a product decision, not an industry default. It should be opt-in if added.

### D. Cache archives only, keep one installed version

Store the last N downloaded `.tgz`/`.zip` files in an XDG cache with metadata; install only
the current version. Rollback re-extracts a cached archive.

- Pros: smaller than installed versions (204 MB vs 599 MB for code-server); enables offline
  reinstall and faster rollback.
- Cons: rollback still needs an extract/install step; cache lifecycle and size caps; archives
  are platform-specific; package assets are not useful here.
- This is better treated as a separate `hi cache` feature, not as upgrade retention.

## Recommendation

1. **Default to A for now.** Keep zero versions and document `hi get -t <old-tag>` as the
   rollback path. This matches Homebrew's effective default and avoids a layout change before
   there is evidence users need one.
2. **If a safety net is wanted, implement B, not C.** One previous version with a TTL is
   enough for the common "new release broke" case and keeps disk bounded.
3. **Do not add a three-release rotation by default.** It is not what Homebrew, Scoop or mise
   do, and for bundles like code-server it can consume gigabytes. If N-version retention is
   ever added, make it opt-in (`keepVersions: 3`) and only for providers where `hi` owns the
   install.
4. **Keep archives out of the default path.** If archive caching is added later, cap it by
   size and age and expose `hi cache` separately.

## Open questions

- Is rollback a real requirement, or is "reinstall the old tag" sufficient? Homebrew assumes
  the latter.
- Should retention apply only to directory bundles and single binaries (provider `git` /
  `mise`), while packages and Docker stay provider-managed?
- What is the disk budget? `code-server` is 599 MB installed; this machine has ~27 GB free on
  the bundle volume (95% used), so a default multi-version retention is risky.
- Should `hi rollback` automatically hold the rolled-back tool, or leave it upgradeable?
- If B is chosen: is the holding area under `bundlePath` (same volume, fast rename) or under
  the state directory (cleaner separation)?
- State shape: a single `previous` record, or a bounded `versions` array with timestamps?

## Proposed surface (only if B/C is approved)

```bash
hi upgrade --keep 1          # override retention for this run
hi rollback <name>           # switch to the previous retained version
hi versions <name>           # list retained versions and their state
hi prune [--keep N] [--dry-run]
```

Possible config:

```jsonc
{
  "retention": {
    "keepVersions": 1,
    "maxAgeDays": 7
  }
}
```

No field names are final; they are listed to make the scope concrete.

## Verification plan (when code is approved)

- Bundle upgrade: old tree is moved/pruned, new tree is live, symlink points at the new
  version.
- Single-binary upgrade: old file is retained only when configured; rollback swaps it back.
- Prune: keeps exactly N / TTL, never removes the current version, `--dry-run` is accurate.
- State: history survives reload, legacy state still parses, removed versions are dropped.
- Providers: package and Docker upgrades remain provider-managed and are not retained by `hi`.
- Failure: a failed upgrade must leave the current version and its state intact.
- Disk: `code-server` bundle upgrade with one retained version, measured before/after.

## Lessons / notes

- Retention and rollback are separate features. Keeping archives is not the same as keeping a
  runnable install.
- Homebrew's cleanup gate is a subtle source of surprise: old versions linger when the newest
  known version is not installed, even though the policy is "keep one".
- "Keep 3" sounds small but is arbitrary; measure the largest bundle first.
- A versioned layout is the prerequisite for `switch` / `rollback`; it is a larger change than
  adding a cleanup flag.
- The current `hi get -t <tag>` path is already a valid, if slower, rollback. Document it
  before building a second mechanism.

## Sources

- Homebrew FAQ: <https://docs.brew.sh/FAQ>
- Homebrew manpage: <https://docs.brew.sh/Manpage>
- Homebrew `formula.rb` (`eligible_kegs_for_cleanup`):
  <https://github.com/Homebrew/brew/blob/master/Library/Homebrew/formula.rb>
- Scoop cleanup: <https://github.com/ScoopInstaller/Scoop/blob/master/libexec/scoop-cleanup.ps1>
- Scoop FAQ: <https://github.com/ScoopInstaller/Scoop/wiki/FAQ>
- mise upgrade: <https://mise.jdx.dev/cli/upgrade.html>
- mise prune: <https://mise.jdx.dev/cli/prune.html>
