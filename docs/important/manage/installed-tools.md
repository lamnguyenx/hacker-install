# Manage installed tools

## List installed tools

```bash
hi ls
hi ls --json
hi ls --hold
```

Output adapts to the terminal width — no borders, no wrapping:

```text
Installed tools (2)

  code-server · v4.143.1 · binary · github
  github.com/coder/code-server · VS Code in the browser

  lazygit · v0.54.1 · binary · github · held
  github.com/jesseduffield/lazygit · Simple terminal UI for git commands
```

Held tools carry a bold yellow `held` tag. Low-priority columns are dropped before anything is cut mid-word, and piped output is never truncated. `hi ls --json` prints an array with `name`, `version`, `type`, `hold`, `source`, and `description` fields for scripts.

## Show info about an installed tool

```bash
hi info kubectx
```

## Remove an installed tool

```bash
hi rm gron
```

For packages, `hi rm` uses the actual package-manager name recorded at install time. For directory-wrapped releases, it removes both the symlink and the bundle tree.

## Update installed tools

```bash
# Upgrade all tools
hi upgrade

# Upgrade one tool
hi upgrade zen

# Upgrade only packages
hi upgrade --pkg

# Force reinstall even when the published date is unchanged
hi upgrade --force
```

`hi upgrade` checks tools concurrently, prints the pending upgrades, and asks for confirmation. Use `-y` to skip the prompt.

## Hold updates

```bash
hi hold k9s
hi ls --hold
hi hold k9s --unset
```
