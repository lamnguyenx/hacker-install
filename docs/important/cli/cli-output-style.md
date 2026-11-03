# CLI output style

Terminal output is a UI. Rules here exist because `hi ls` used to be a fixed six-column
`cli-table3` box (~100 chars) that turned into noise on a narrow terminal.

## Lists (default for "many things")

Use the borderless renderer in `src/ui/list.ts` (`renderToolList`) as the reference shape:

```
Installed tools (2)

  code-server · v4.143.1 · bundle · github
  ~/.local/bin/code-server -> ~/Downloads2/code-server/code-server-4.143.1-linux-amd64/bin/code-server
  github.com/coder/code-server · VS Code in the browser

  lazygit · v0.54.1 · binary · github · held
  github.com/jesseduffield/lazygit · Simple terminal UI for git commands
```

Shape:

1. Header: styled title + dim `(N)`.
2. Blank line.
3. Per entry: a **tags line** (`name · version · type · provider · flags`), an optional
   **symlink line** (`link -> target`), and an optional **detail line**
   (`source · description`).
4. Blank line between entries.

`type` is `binary` for a copied single binary, `bundle` for a directory-wrapped release,
`symlink` for any other install-path link, or the package type (`deb` / `rpm` / `AppImage`).
Symlink paths are shortened against the home directory.

### Width

- Resolve width with `terminalWidth()`: `process.stdout.columns` → `COLUMNS` → `80`.
- When stdout is not a TTY (piped, redirected, tests), pass `width: 0` and never truncate.
  Machine-readable output must stay complete; scripts also have `--json`.
- When a line exceeds the width, **drop whole low-priority tags** instead of cutting them:
  priority is `name → version → type → provider → flags`.
- Split the symlink line into `link` and `-> target` lines, then wrap a long target at `/`
  boundaries with a three-space continuation. The whole destination survives on an 80-column
  terminal. Truncate only what still cannot fit: the name (when it alone overflows), a single
  over-long path segment, and the tail of the detail line, using `…`.
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

## Preview blocks (no box tables)

`src/ui/table.ts` renders data as styled text, not a bordered table. There are no
ASCII/box-drawing borders and `cli-table3` is not a dependency.

- **Single row → vertical field list.** `hi get`'s install preview and `hi info` print one
  `Key   Value` line per field. Long filenames and URLs stay complete instead of wrapping in a
  cell.
- **Several rows → aligned columns.** Asset lists and cross-tool comparisons use a bold +
  underlined header row and plain space alignment.
- **Emphasis carries hierarchy:** titles are bold + underlined, keys are bold and coloured,
  long free-text values (over 44 columns) are italic.
- **Width:** only non-final columns are truncated (with `…`) at 44 columns; the last column is
  allowed to run. Piped output and `NO_COLOR` keep the same text, just without styling.

## Progress bars

The bar lives in `src/ui/progress.ts` and follows these rules. They are not cosmetic: every one
of them prevents a specific failure seen in the wild.

- **Stay strictly narrower than the terminal** (`columns - 1`). A line that fills the last
  column makes the terminal wrap; the next update then clears the new row and leaves the old
  frame behind — a trail of half-drawn bars.
- **Do not depend on `\r`.** Some terminals, pty wrappers and log renderers translate carriage
  returns into newlines. Each frame is newline-terminated; the next frame emits
  `ESC[1A` + `ESC[2K` (cursor up, erase line) and redraws. `finish()` erases the line the same
  way.
- **Degrade instead of wrapping:** drop ETA, then speed, then shrink the bar (minimum 8
  columns), then middle-ellipsize the label.
- **Throttle to ~12 fps** and skip identical frames.
- **Draw 100% once.** A download can sit at full size while aria2c finalises; redrawing would
  show a falling speed at 100%.
- **Enable only when stderr is a TTY**; `--quiet` and piped runs stay clean.

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
