# Config, state and paths

The CLI owns exactly one namespace: `hacker/hacker-install`. The Python implementation is
sunset; there is no second location and no second schema.

## Locations

| File   | Path                                                                 |
| ------ | -------------------------------------------------------------------- |
| Config | `${XDG_CONFIG_HOME:-~/.config}/hacker/hacker-install/config.jsonc`   |
| State  | `${XDG_STATE_HOME:-~/.local/state}/hacker/hacker-install/state.json` |

Overrides (mainly tests and portable setups):

```bash
HI_CONFIG_DIR=/tmp/hi/config   # file becomes $HI_CONFIG_DIR/config.jsonc
HI_STATE_DIR=/tmp/hi/state     # file becomes $HI_STATE_DIR/state.json
```

Relative `XDG_*` values are ignored and fall back to the home-relative defaults.

Source: `src/paths.ts` (`APP_NAMESPACE`, `resolvePaths`).

## Config schema

```jsonc
{
  "version": 1,
  "installPath": "~/.local/bin", // where binaries and symlinks land
  "bundlePath": "~/Downloads2", // where directory-wrapped releases are kept
  "preRelease": false,
  "tokens": {
    "github": "",
    "gitlab": { "gitlab.com": "" },
    "forgejo": { "codeberg.org": "" }
  }
}
```

- `version` is `CONFIG_VERSION` (currently `1`). A file with a higher version is rejected.
- Paths accept `~` and are expanded at use time (`AppContext.installPath` / `bundlePath`).
- Missing keys fall back to `defaultConfig()`.
- Written atomically with mode `0600`; saving emits plain JSON, so **comments and trailing
  commas are accepted on read but lost on write**.
- Update via `hi config`, not by hand, when possible:

```bash
hi config --path ~/.local/bin
hi config --bundle-path ~/Downloads2
hi config --github-token <token>
hi config --pre-release
hi config --no-pre-release
```

## State schema

```jsonc
{
  "version": 1,
  "tools": {
    "<name>": {
      "name": "code-server",
      "provider": "github",
      "source": "https://github.com/coder/code-server",
      "tagName": "v4.143.1",
      "publishedAt": "2026-10-23T23:04:54Z",
      "prerelease": false,
      "description": "...",
      "assets": [
        /* selected release asset */
      ],
      "holdUpdate": false,
      "packageType": "binary",
      "installMethod": "binary"
      // optional: packageName, dockerOpts, customReleaseWords
    }
  }
}
```

- Keys are tool names, not `<source>#<name>`.
- Release fields are camelCase; snake_case is tolerated when reading.
- `hi state` prints the raw file; `hi ls --json` prints the reduced list shape.

## Legacy Python format is rejected

Old files are **not** read or auto-converted. They produce an actionable error so they cannot
be silently overwritten:

- Config with a nested `config` object → `Legacy Python config detected ...`
- State as a flat `<source>#<name>` map → `Legacy Python state detected ...`

Recovery is to delete the old file and either re-run `hi config` or reinstall the tools with
`hi get`. Binaries already installed are unaffected — state only records what exists.

## Conventions to keep

- Do not add a second namespace, a fallback path, or a legacy reader. One path, one shape.
- Keep `installPath` and `bundlePath` semantically separate; see
  [install-flow.md](./install-flow.md).
- Any new persisted field must be optional on read and defaulted in `parseConfig` /
  `parseInstalledTool`, so old files keep loading.
- Bump `CONFIG_VERSION` / `STATE_VERSION` only with a real migration story; newer-version files
  are rejected on purpose.
