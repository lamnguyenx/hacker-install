# Configuration

Config lives at:

```text
${XDG_CONFIG_HOME:-~/.config}/hacker/hacker-install/config.jsonc
```

State lives at:

```text
${XDG_STATE_HOME:-~/.local/state}/hacker/hacker-install/state.json
```

For tests or portable setups, `HI_CONFIG_DIR` and `HI_STATE_DIR` override the directories.

The config/state schema and the legacy-format rejection rules live in
[config, state and paths](./files-and-paths.md). Where files physically land is covered by
[install flow](../install/install-flow.md).

## Install path

```bash
hi config --path ~/.local/bin
```

Default: `~/bin`.

## Bundle path

Directory-wrapped releases (for example `bin/code-server` plus a `lib/` runtime) are extracted here. Default: `~/Downloads2`.

Single-file binaries are copied into the install path instead, and downloaded archives are removed after extraction — `bundlePath` is not a download history.

```bash
hi config --bundle-path ~/.local/share/hacker-install
```

## Pre-releases

```bash
# Include pre-releases when checking for updates
hi config --pre-release

# Exclude them again
hi config --no-pre-release
```

Omitting both flags leaves the current setting unchanged.

## Provider tokens

Tokens raise API rate limits and allow authenticated access to private/self-hosted instances.

```bash
# GitHub
hi config --github-token <token>

# GitLab.com
hi config --gitlab-token <token>

# Codeberg/Forgejo
hi config --codeberg-token <token>
```

Hosts are stored per instance:

```bash
hi config --gitlab-token <token> --host gitlab.example.com
hi config --codeberg-token <token> --host git.example.com
```

Self-hosted hosts are registered automatically the first time you install from them, so a token is only needed when the instance requires authentication.
