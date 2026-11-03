# Commands

```text
hi get <url> [options]        Install a CLI tool
hi upgrade [name] [options]   Upgrade installed tools
hi ls [options]               List installed tools
hi info <name>                Show info about an installed tool
hi rm [name]                  Remove an installed tool
hi config [options]           Update configuration
hi state                      Print the raw state file
hi pull --url <url>           Install tools from a remote state URL
hi hold [name] [--unset]      Hold/unhold updates for a tool
hi me [options]               Show version or self-upgrade
```

Run `hi <command> --help` for command-specific options.

## Shell completion

```bash
# Show completion script
hi --show-completion zsh

# Install completion for the current or specified shell
hi --install-completion zsh
hi --install-completion bash
hi --install-completion fish
```
