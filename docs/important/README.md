# Important notes

Durable reference material: decisions, contracts, and how-tos that should outlive a single
task. Dated task write-ups live in [`../plans/`](../plans/).

| Doc                                          | Covers                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [files-and-paths.md](./files-and-paths.md)   | Canonical config/state/completion locations, schemas, env overrides, why the Python format is rejected |
| [install-flow.md](./install-flow.md)         | `installPath` vs `bundlePath`, temp dirs, bundle symlinks, removal rules                               |
| [cli-output-style.md](./cli-output-style.md) | Width-aware lists, colour semantics, tables vs lists, JSON stability                                   |
| [releasing.md](./releasing.md)               | CalVer, the npm publish flow, GitHub Actions, release verification                                     |

Rules of thumb:

- One namespace, one schema: `hacker/hacker-install`.
- One package, one command: npm package `hacker-install`, CLI `hi`.
- `installPath` is on `PATH`; `bundlePath` is not. The default `installPath` is `~/bin`,
  which is not guaranteed to be searchable.
- Local checkouts use `make install-e` for an editable global `hi`; a plain
  `bun add -g ./` installs a copy and needs `bun run build:npm` first.
- Terminal output adapts to width; piped output is complete and unstyled.
- Versions are `YYYY.MM.DD`, sourced from `package.json`, and baked into the build.
