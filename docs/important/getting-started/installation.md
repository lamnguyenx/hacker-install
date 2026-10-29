# Installation

## Option 1: Standalone binary (recommended)

Download the latest binary for your platform from [GitHub Releases](https://github.com/lamnguyenx/hacker-install/releases). No Bun installation is required.

### Linux x86_64 (glibc)

```bash
mkdir -p ~/bin
curl -Lo ~/bin/hi https://github.com/lamnguyenx/hacker-install/releases/latest/download/hacker-install-linux-x86_64
chmod +x ~/bin/hi
```

### Linux aarch64 (glibc)

```bash
curl -Lo ~/bin/hi https://github.com/lamnguyenx/hacker-install/releases/latest/download/hacker-install-linux-aarch64
chmod +x ~/bin/hi
```

### Alpine/musl

Use `hacker-install-linux-x86_64-musl` or `hacker-install-linux-aarch64-musl`. The musl build needs the C++ runtime:

```bash
apk add libstdc++
```

### macOS

```bash
# Apple Silicon
curl -Lo ~/bin/hi https://github.com/lamnguyenx/hacker-install/releases/latest/download/hacker-install-darwin-arm64

# Intel
curl -Lo ~/bin/hi https://github.com/lamnguyenx/hacker-install/releases/latest/download/hacker-install-darwin-x86_64

chmod +x ~/bin/hi
```

Then register the binary under the name `hi` so `hi me --upgrade` updates the same file:

```bash
~/bin/hi get https://github.com/lamnguyenx/hacker-install -n hi
```

Add `~/bin` to your `PATH`:

```bash
# Bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc

# Zsh
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc

# Fish
echo 'set -gx PATH $HOME/bin $PATH' >> ~/.config/fish/config.fish
```

## Option 2: Bun or npm

The npm package is a Bun-target bundle, so Bun 1.4+ must be installed.

```bash
# With Bun (recommended)
bun add -g hacker-install

# Or with npm; the `hi` launcher runs through Bun
npm install -g hacker-install
```

The package installs a single command: `hi`.

> Installing from a local clone? See [Local development](../development/local-setup.md) for the
> editable-install recipe. Briefly: `bun link` tracks the built `dist/npm/index.js`, so it needs
> a rebuild after every source change; a launcher script that executes `src/index.ts` is the
> `pip install -e` equivalent. `bun add -g .` with a relative path is broken in Bun 1.4.x — it
> resolves the spec to an empty package name. Use an absolute path or `bun link`.

> If you installed globally with Bun/npm, update with `bun update -g hacker-install` or `npm update -g hacker-install`. `hi me --upgrade` detects a global package install and prints this reminder instead of overwriting `~/bin/hi`.

## Option 3: Build from source

```bash
git clone https://github.com/lamnguyenx/hacker-install
cd hacker-install
bun install
bun run dev -- --help

# Compile a native binary for the current platform
bun run build
./dist/hacker-install-<platform> --help

# Build the npm bundle and link the CLI locally
bun run build:npm
bun link
```

## Requirements

- **Standalone binary:** Linux, macOS, or WSL. No runtime dependency. Alpine/musl builds additionally need `libstdc++` (`apk add libstdc++`).
- **npm/Bun install:** Bun 1.4.3 or newer.
- **Extraction:** tar, tar.gz, tar.zst, zip, and raw binaries are handled natively. `.xz`, `.bz2`, and `.7z` archives use the system `xz`, `bzip2`, and `7z` tools when present.
- **Package mode:** Linux and the relevant package manager (`dpkg`/`apt`, `dnf`/`yum`/`rpm`) or AppImage support.
- **Docker mode:** the `docker` CLI.
