# Local development

```bash
bun install

# Run from source
bun run dev -- --help

# Tests (no network, Docker, or sudo required)
bun test

# Type checking and formatting/linting
bun run typecheck
bun run lint
bun run format
bun run check

# Native standalone binary
bun run build

# All release targets (linux/darwin, x64/arm64, glibc/musl)
bun run build:all

# npm bundle at dist/npm/index.js
bun run build:npm

# Link this checkout as the global `hi` (tracks dist/npm/index.js)
bun link
```

The default test suite is fully mocked: it does not need network access, Docker, sudo, or a real package manager. Real installs can be exercised manually with `bun run dev -- get <url>`.

## Editable install (`pip install -e` equivalent)

`bun link` links the package folder, but `package.json` points `hi` at `./dist/npm/index.js` — a
generated bundle. A linked install therefore runs the last build; in a fresh checkout the file
does not exist yet, so Bun silently creates no `hi` command (and still prints its PATH hint).

For a checkout that is live on every edit, use the Makefile target:

```bash
make install-e
hi --version      # runs src/index.ts directly
```

`install-e` runs `bun install`, writes a dev launcher at `dist/npm/index.js`
(`#!/usr/bin/env bun` importing `../../src/index.ts`), marks it executable, and runs `bun link`.
The resulting chain is:

```text
~/.bun/bin/hi
    -> ~/.bun/install/global/node_modules/hacker-install   (bun link symlink)
        -> <checkout>
            -> dist/npm/index.js                           (dev launcher)
                -> src/index.ts                            (executed by Bun)
```

- Every edit, including new files, takes effect on the next run; no rebuild step.
- `bun run build:npm` overwrites the launcher with the real bundle. Re-run `make install-e` to
  return to editable mode.
- `bun link` stores an absolute path, so moving the checkout means re-running `make install-e`.
- Revert with `rm ~/.bun/bin/hi && bun install -g hacker-install`.

To install a copy instead, run `bun run build:npm` first, then `bun add -g ./` or
`npm i -g .`. Without `dist/npm/index.js`, Bun reports `binaries: hi` but silently skips the
`hi` link, so verify with `command -v hi`. Avoid `bun add -g .` without a local install: it has
been broken in some Bun 1.4.x releases (relative path resolved as an empty package name).

To run a one-off command without installing anything:

```bash
bun run dev -- get https://github.com/denoland/deno
bun src/index.ts --help
```
