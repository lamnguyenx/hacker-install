# Install from GitHub, GitLab, and Codeberg

Supported URL forms:

```text
https://github.com/<owner>/<repo>
https://gitlab.com/<group>/<repo>
https://codeberg.org/<owner>/<repo>
```

```bash
hi get https://github.com/denoland/deno
hi get https://gitlab.com/gitlab-org/cli -n glab
hi get https://codeberg.org/forgejo/forgejo
```

`hi` reads the latest stable release, scores every asset for your OS, architecture, libc, and package family, and installs the best match. If a directory-wrapped release contains `bin/<tool>`, the whole tree is kept under `bundlePath/<tool>/<version-dir>/` and `bin/<tool>` is symlinked into your install path. The version dir is the archive's top-level folder when it carries the release version, otherwise the release tag.

Useful options:

```text
-t, --tag <tag>       Select a specific release version
-f, --file <file>     Select a specific release asset filename
-n, --name <name>     Install under a custom command name
-y, --yes             Skip the confirmation prompt
-F, --force           Reinstall even when the same release is already installed
--pkg                 Install a deb/rpm/AppImage package
--docker-opts <opts>  Extra docker run options (docker@ only)
```

If the selected asset and release already match the installed tool and the
binary is still present, `hi get` reports it as up to date and stops before
downloading. Use `--force` when you want to reinstall anyway.

## Self-hosted GitLab and Forgejo

Self-hosted instances use a provider prefix. HTTPS is assumed:

```text
gitlab@<host>/<group>/<repo>
forgejo@<host>/<owner>/<repo>
```

```bash
# GitLab subgroups are supported
hi get gitlab@gitlab.example.com/group/subgroup/mytool

# Self-hosted Forgejo/Gitea
hi get forgejo@git.example.com/owner/mytool
```

Tokens are stored per host. See [Provider tokens](../configuration/configuring.md#provider-tokens).
