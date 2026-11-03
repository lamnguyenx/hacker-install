# Install via mise/aqua

Some tools do not publish platform assets on their GitHub releases. For those, use the mise registry with the `mise@` prefix:

```bash
hi get mise@terraform

# Pin a version inline or with --tag
hi get mise@terraform:v1.12.0
hi get mise@terraform -t v1.12.0
```

`hi` resolves the mise registry entry, expands the aqua asset URL template for your OS/architecture, downloads it, and installs the binary. Tools installed this way are tracked and upgraded like Git tools.

> The mise provider currently supports `github_release` and `http` aqua package types.
