<p align="center">
  <img src="./.github/images/banner.png" alt="Hacker Install — easily install any release" width="100%" />
</p>
<p align="center">
  <em>CLI to install any CLI</em>
  <br><br>
  <a href="https://bun.sh/">
    <img src="https://img.shields.io/badge/Bun-1.4%2B-black" alt="Bun Version" />
  </a>
  <a href="https://www.npmjs.com/package/hacker-install">
    <img src="https://img.shields.io/npm/v/hacker-install" alt="npm" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/license-GPL--3.0-blue" alt="License" />
  </a>
</p>

<br>

**Hacker Install** gives you the `hi` command to install and keep single-binary CLI tools
updated on Linux, macOS, and WSL. It reads GitHub, GitLab, Codeberg/Forgejo releases, and also
supports mise/aqua registry entries and Docker images.

This is the TypeScript/Bun implementation and the only maintained version of Hacker Install. It
replaces the original Python CLI (archived as
[`hacker-install-python`](https://github.com/lamnguyenx/hacker-install-python)) and owns all
config/state under `~/.config/hacker/hacker-install/` and
`~/.local/state/hacker/hacker-install/`.

<img src=".github/images/787536.gif" alt="CLI demo" width="100%" />

> INFO: mainly for tools that are not directly available from package managers like `apt`,
> `yum`, `pacman`, or `brew`.

## Highlights

- **Release installs** — give `hi` a repository URL and it picks the right asset for your OS,
  architecture, libc, and package family.
- **System packages** — `.deb`, `.rpm`, and AppImage assets with `--pkg`.
- **Other sources** — `mise@terraform` (registry/aqua) and `docker@image` wrappers.
- **Idempotent installs** — `hi get` stops when the same release and asset are already
  installed; `-F/--force` reinstalls.
- **Fast, resumable downloads** — aria2c with 8 connections when installed, built-in resume
  fallback otherwise.
- **Readable output** — width-aware text previews (bold/italic/underline, no box tables) and a
  single-line progress bar that survives narrow terminals and pty wrappers.

## Layout

- `src/` — CLI commands (`app/`), providers (`providers/`), download/extract, UI (`ui/`), and
  the config/state layer.
- `test/` — mocked Bun tests; no network, Docker, sudo, or real package manager required.
- `docs/important/` — durable topic docs; the index is below.
- `docs/plans/` — dated implementation logs, including trials, errors, and lessons learnt.
- `scripts/` — build entry point (`bun run build`, `build:all`, `build:npm`).
- `.github/` — CI workflows and README images.

## Quickstart

```bash
# Install (Linux x86_64; every platform is in the Installation doc)
mkdir -p ~/bin
curl -Lo ~/bin/hi https://github.com/lamnguyenx/hacker-install/releases/latest/download/hacker-install-linux-x86_64
chmod +x ~/bin/hi

# Or, with Bun: bun add -g hacker-install

hi get https://github.com/denoland/deno
hi get mise@terraform
hi ls
hi upgrade
```

Start with [Installation](docs/important/getting-started/installation.md) for the standalone
binary, npm/Bun, and build-from-source paths. Then jump to the source you use:
[GitHub/GitLab/Codeberg](docs/important/install/git-providers.md),
[mise/aqua](docs/important/install/mise-aqua.md), or
[Docker](docs/important/install/docker.md); manage the results with
[Installed tools](docs/important/manage/installed-tools.md).

## Docs

### [CLI](docs/important/cli/)

- [Commands](docs/important/cli/commands.md): the command table, flags, and shell completion.
- [CLI output style](docs/important/cli/cli-output-style.md): list and preview renderers,
  progress-bar rules, colour semantics, JSON stability.

### [Getting started](docs/important/getting-started/)

- [Installation](docs/important/getting-started/installation.md): standalone binary, Bun/npm,
  build from source, requirements.
- [Upgrading from the Python version](docs/important/getting-started/migration-from-python.md):
  what changed and how to move config/state.

### [Installing tools](docs/important/install/)

- [GitHub, GitLab, and Codeberg](docs/important/install/git-providers.md): URL forms,
  self-hosted prefixes, and `hi get` options.
- [System packages](docs/important/install/packages.md): `--pkg` for deb/rpm/AppImage.
- [mise/aqua](docs/important/install/mise-aqua.md): `mise@tool` registry installs.
- [Docker](docs/important/install/docker.md): wrapping an image as a local command.
- [Asset selection](docs/important/install/asset-selection.md): interactive IDs and `--file`.
- [Install flow and layout](docs/important/install/install-flow.md): temp dirs, bundles,
  symlinks, downloads, removal.

### [Managing tools](docs/important/manage/)

- [Installed tools](docs/important/manage/installed-tools.md): list, info, remove, upgrade,
  hold.
- [State sync](docs/important/manage/state-sync.md): `hi pull` to clone your tool list.

### [Configuration](docs/important/configuration/)

- [Configuring](docs/important/configuration/configuring.md): install/bundle paths,
  pre-releases, provider tokens.
- [Config, state and paths](docs/important/configuration/files-and-paths.md): file locations,
  schemas, environment overrides, legacy rejection.

### [Development](docs/important/development/)

- [Local setup](docs/important/development/local-setup.md): run from source, tests, and the
  editable-install (`pip install -e`) recipe.
- [Releasing](docs/important/development/releasing.md): CalVer, npm publish, CI, verification.
- [Release assets](docs/important/development/release-assets.md): binary names, platforms, and
  checksums.

## Elsewhere

- [Dated plans](docs/plans/) — implementation write-ups with trials, errors, and lessons learnt.
- [npm package](https://www.npmjs.com/package/hacker-install) and
  [GitHub Releases](https://github.com/lamnguyenx/hacker-install/releases).
- [License](./LICENSE) — GPL-3.0.
