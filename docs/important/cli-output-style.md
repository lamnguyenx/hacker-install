# CLI output style

Terminal output is a UI. Rules here exist because `hi ls` used to be a fixed six-column
`cli-table3` box (~100 chars) that turned into noise on a narrow terminal.

## Lists (default for "many things")

Use the borderless renderer in `src/ui/list.ts` (`renderToolList`) as the reference shape:

```
Installed tools (2)

  code-server · v4.143.1 · binary · github
  github.com/coder/code-server · VS Code in the browser

  lazygit · v0.54.1 · binary · github · held
  github.com/jesseduffield/lazygit · Simple terminal UI for git commands
```

Shape:

1. Header: styled title + dim `(N)`.
2. Blank line.
3. Per entry: a **tags line** (`name · version · type · provider · flags`) and an optional
   **detail line** (`source · description`).
4. Blank line between entries.

### Width

- Resolve width with `terminalWidth()`: `process.stdout.columns` → `COLUMNS` → `80`.
- When stdout is not a TTY (piped, redirected, tests), pass `width: 0` and never truncate.
  Machine-readable output must stay complete; scripts also have `--json`.
- When a line exceeds the width, **drop whole low-priority tags** instead of cutting them:
  priority is `name → version → type → provider → flags`.
- Truncate only what cannot be dropped: the name (when it alone overflows) and the tail of
  the detail line, using `…`.
- Optional text with almost no room (descriptions under 16 columns) is omitted rather than
  rendered as a two-word stub.
- Keep the two-space indent; it visually separates entries from the header and from shell
  prompts.

### Colour and emphasis

Colour is assigned by **meaning**, not per column, so commands stay consistent:

| Meaning                                | Style                   | Example                        |
| -------------------------------------- | ----------------------- | ------------------------------ |
| Section title                          | bold + underline + cyan | `Installed tools`              |
| Counts, separators, secondary metadata | dim                     | `(2)`, `·`, provider, type     |
| Primary identifier                     | bold cyan               | tool name                      |
| Version                                | green                   | `v4.143.1`                     |
| State/attention                        | bold yellow             | `held`                         |
| Links / locations                      | dim + underline         | `github.com/coder/code-server` |
| Prose detail                           | dim + italic            | description                    |

Rules:

- Never rely on colour alone. State is always spelled out (`held`, not just yellow), so
  `NO_COLOR`, pipes, and colour-blind users get the same information.
- picocolors handles `NO_COLOR` / `FORCE_COLOR` / TTY detection; do not hand-roll escapes.
- Do not colour every column. Two or three accents per line is the budget.

## Tables (only for prompts and dense comparisons)

`cli-table3` (`src/ui/table.ts`) is still acceptable when the user must **compare several
fields before acting**: asset selection, "tools to be installed" confirmation, `hi info`.
Even then:

- Prefer few columns and short values.
- `hi info` is the next candidate for a key–value block; long URLs in a table wrap badly.
- Do not use a table just to print a list of names.

## JSON

- `--json` output is a stable contract: no styling, no ANSI, no truncation, no new keys
  unless necessary (additive only).
- The text view may show extra data (e.g. `provider`) without changing the JSON shape; strip
  text-only fields before serialising.
- Keep arrays deterministic (sorted by name for `hi ls`).

## Adding a new listing command

1. Build plain data objects first; keep presentation separate.
2. Reuse `renderToolList` or follow its shape (`packLine`, `textWidth`, `terminalWidth`).
3. Pass width `0` when `io.isTTY` is false.
4. Add tests for: width clamping, dropped tags, no truncation when piped, and (if stateful)
   the marker text used instead of colour.
