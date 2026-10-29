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
does not exist yet, so Bun silently creates no `hi` command. Rebuild with `bun run build:npm`
after every change, or use a launcher that runs the sources directly.

For a checkout that is live on every edit, put a small wrapper at the global bin:

```sh
#!/bin/sh
# ~/.bun/bin/hi — adjust both absolute paths
exec /home/you/.bun/bin/bun /home/you/git/hacker-install/src/index.ts "$@"
```

```bash
chmod +x ~/.bun/bin/hi
hi --version      # runs src/index.ts directly
```

- Every edit, including new files, takes effect on the next run; no rebuild step.
- `~/.bun/bin` is already on `PATH` for Bun installs. Keep absolute paths in the wrapper so
  `hi` works from any directory.
- Revert with `rm ~/.bun/bin/hi && bun install -g hacker-install`. A later `bun update -g`
  recreates the symlink and shadows the wrapper; recreate the wrapper afterwards.

Avoid `bun install -g ./` and `bun add -g .`: in Bun 1.4.x a relative path is resolved as an
empty package name (`refusing to install dependency with unsafe name`, and a junk `""` entry in
the global manifest). An absolute path (`bun install -g "$PWD"`) links the folder, but it still
runs `dist/npm/index.js`, so it is not editable either.

To run a one-off command without installing anything:

```bash
bun run dev -- get https://github.com/denoland/deno
bun src/index.ts --help
```
