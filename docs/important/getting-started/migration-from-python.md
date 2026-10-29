# Upgrading from the Python version

The Python CLI is sunset. Its repository is archived as
[`hacker-install-python`](https://github.com/lamnguyenx/hacker-install-python). This version
owns the same paths, so uninstall the Python entry point first — two `hi` binaries writing the
same files would clobber each other:

```text
~/.config/hacker/hacker-install/config.jsonc
~/.local/state/hacker/hacker-install/state.json
```

The file format changed with the rewrite:

- Config is flat camelCase (`installPath`, `bundlePath`, `preRelease`, `tokens`) instead of the nested `config` object with snake_case keys.
- State is `{ "version": 1, "tools": { "<name>": { ... } } }`, keyed by tool name with camelCase release fields instead of `<source>#<name>` keys with snake_case fields.

The state file only records installed tools — the binaries already live in your install path — so the simplest migration is to reinstall what you use:

```bash
hi config --path ~/.local/bin
hi get https://github.com/coder/code-server
```

Leftover Python-format files are rejected with an error instead of being silently ignored, so `hi` never overwrites them by accident.
