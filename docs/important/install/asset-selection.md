# Choose a specific release asset

If automatic selection picks the wrong asset, use interactive selection or `--file`.

## Interactive selection

```bash
hi get https://github.com/ekzhang/bore
```

At the prompt, enter an asset ID instead of `y`:

```text
Install selected tool? [Y/n/ Asset ID]: 3
```

`hi` stores the selected filename's keywords so future upgrades keep the same variant.

## `--file`

```bash
hi get https://github.com/ekzhang/bore -f bore-v0.4.0-arm-unknown-linux-musleabi.tar.gz
```

The filename is parsed into keywords (`bore`, `arm`, `linux`, `musleabi`, ...) and stored for upgrades.
