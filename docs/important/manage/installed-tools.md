# Manage installed tools

## List installed tools

```bash
hi ls
hi ls --json
hi ls --hold
```

Output adapts to the terminal width — no borders; long link targets wrap instead of being
truncated:

```text
Installed tools (2)

  code-server · v4.143.1 · bundle · github
  ~/.local/bin/code-server -> ~/Downloads2/code-server/code-server-4.143.1-linux-amd64/bin/code-server
  github.com/coder/code-server · VS Code in the browser

  lazygit · v0.54.1 · binary · github · held
  github.com/jesseduffield/lazygit · Simple terminal UI for git commands
```

`type` describes how the tool landed on disk: `binary` for a copied single binary, `bundle`
for a directory-wrapped release, `symlink` for any other link, and `deb` / `rpm` / `AppImage`
for system packages. Bundle and other symlink installs print the install-path link and its
original location on their own line. Bundles live under
`bundlePath/<name>/<version-dir>/`: the archive's top-level folder when it carries the release
version, otherwise the release tag (appended if a folder name exists). Long target paths wrap
instead of being truncated.

Held tools carry a bold yellow `held` tag. Low-priority columns are dropped before anything is cut mid-word, and piped output is never truncated. `hi ls --json` prints an array with `name`, `version`, `type`, `hold`, `source`, and `description` fields for scripts; symlink installs also include `symlink: { path, target }`.

## Show info about an installed tool

```bash
hi info kubectx
```

```text
Info: code-server

  Name         code-server
  Description  VS Code in the browser
  Source       https://github.com/coder/code-server
  Type         bundle
  Symlink      /home/you/.local/bin/code-server
  Target       /home/you/Downloads2/code-server/code-server-4.143.1-linux-amd64/bin/code-server
```

`Type` reports the on-disk install shape. Symlink installs also list `Symlink` (the install
path entry) and `Target` (its original location).

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
