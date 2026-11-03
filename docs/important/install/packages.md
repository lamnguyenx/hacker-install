# Install as a system package (deb/rpm/AppImage)

Use `--pkg` when a project ships a package that integrates with your OS:

```bash
hi get https://github.com/redis/RedisInsight --pkg
```

`hi` detects your package family from `/etc/os-release`, falling back to available package managers. On Linux it can install:

- `.deb` via `dpkg`/`apt`
- `.rpm` via `dnf`/`yum`/`rpm`
- AppImage into `~/.local/share/appimages` with a desktop entry and icon

Package installation is Linux-only. `hi upgrade` reports pending package upgrades but does not install them unless you run `hi upgrade --pkg`.
