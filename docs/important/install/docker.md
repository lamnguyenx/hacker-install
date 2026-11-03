# Install a Docker image as a CLI

Wrap any Docker image as a local command:

```bash
hi get docker@hashicorp/terraform
hi get docker@hashicorp/terraform:1.7.0
hi get docker@hashicorp/terraform -t 1.7.0

# Custom command name
hi get docker@mcr.microsoft.com/azure-cli -n az

# Extra docker run options (raw shell; quote spaces)
hi get docker@alpine:latest -n alpine --docker-opts "-v $HOME/data:/data"
```

`hi` pulls the image, detects its entrypoint, and writes an executable wrapper to your install path. The wrapper mounts the current directory at `/tmp/cmd` and runs:

```sh
docker run --rm -i $termflag -v "$PWD:/tmp/cmd" -w /tmp/cmd <opts> <image> <args>
```

Behavior:

- `latest` tags are checked by digest during `hi upgrade` and re-pulled only when the registry digest changes.
- Pinned tags are held from automatic upgrades; `hi upgrade --force` re-pulls them.
- `--docker-opts` is persisted in state and reused on upgrade.
- Re-running `hi get` without `--docker-opts` preserves saved options; pass `--docker-opts ""` to clear them.
