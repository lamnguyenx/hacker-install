# Important notes

Durable reference material: decisions, contracts, and how-tos that should outlive a single
task. Dated task write-ups live in [`../plans/`](../plans/).

| Doc                                          | Covers                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [files-and-paths.md](./files-and-paths.md)   | Canonical config/state locations, schemas, env overrides, why the Python format is rejected |
| [install-flow.md](./install-flow.md)         | `installPath` vs `bundlePath`, temp dirs, bundle symlinks, removal rules                    |
| [cli-output-style.md](./cli-output-style.md) | Width-aware lists, colour semantics, tables vs lists, JSON stability                        |

Rules of thumb:

- One namespace, one schema: `hacker/hacker-install`.
- `installPath` is on `PATH`; `bundlePath` is not.
- Terminal output adapts to width; piped output is complete and unstyled.
