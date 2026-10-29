# Sync state with `hi pull`

Export your TS state file somewhere accessible and install the same tools on another machine:

```bash
hi pull --url https://raw.githubusercontent.com/you/dotfiles/main/hacker-install/state.json

# Also reinstall tools whose local version differs
hi pull --url https://example.com/state.json --override
```

The remote file must use the TypeScript state format documented in
[config, state and paths](../configuration/files-and-paths.md#state-schema).
