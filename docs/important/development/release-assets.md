# Release assets

| Asset                               | Platform            | Libc  |
| ----------------------------------- | ------------------- | ----- |
| `hacker-install-linux-x86_64`       | Linux x86_64        | glibc |
| `hacker-install-linux-aarch64`      | Linux ARM64         | glibc |
| `hacker-install-linux-x86_64-musl`  | Linux x86_64        | musl  |
| `hacker-install-linux-aarch64-musl` | Linux ARM64         | musl  |
| `hacker-install-darwin-x86_64`      | macOS Intel         | —     |
| `hacker-install-darwin-arm64`       | macOS Apple Silicon | —     |

`dist/checksums.txt` contains SHA-256 checksums when building with `--all`.

Release tags use the same calendar version with a `v` prefix (`v2026.10.29`); the npm package uses the version without the prefix.
