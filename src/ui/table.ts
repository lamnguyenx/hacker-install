import pc from "picocolors";

export type StyleFn = (value: string) => string;

export interface TableTheme {
  titleStyle: StyleFn;
  tableStyle: StyleFn;
  borderStyle: StyleFn;
  columnStyles: StyleFn[];
}

export interface ColumnOptions {
  minWidth?: number;
  maxWidth?: number;
}

export interface ShowTableOptions {
  ignoreKeys?: string[];
  title?: string;
  theme?: TableTheme;
  noWrap?: boolean;
  expand?: boolean;
  columnOptions?: Record<string, ColumnOptions>;
}

export const DEFAULT_TABLE_THEME: TableTheme = {
  titleStyle: (value) => pc.bold(pc.green(value)),
  tableStyle: (value) => pc.magenta(value),
  borderStyle: (value) => value,
  columnStyles: [pc.yellow, pc.red, pc.green, pc.cyan, pc.blue],
};

export const DIM_TABLE_THEME: TableTheme = {
  titleStyle: (value) => pc.dim(value),
  tableStyle: (value) => pc.dim(value),
  borderStyle: (value) => pc.dim(value),
  columnStyles: [pc.dim, pc.dim, pc.dim, pc.dim, pc.dim],
};

// ANSI escape sequences (SGR) emitted by picocolors.
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const ELLIPSIS = "…";
/** Cells wider than this get truncated (except the last column) or italicized. */
const MAX_CELL_WIDTH = 44;
/** Values longer than this are set in italics, as running text rather than a field. */
const ITALIC_THRESHOLD = 44;

function visibleLength(value: string): number {
  return value.replace(ANSI_PATTERN, "").length;
}

function pad(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - visibleLength(value)));
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}${ELLIPSIS}`;
}

function styleValue(value: string, style: StyleFn): string {
  const styled = style(value);
  return value.length > ITALIC_THRESHOLD ? pc.italic(styled) : styled;
}

function renderTitle(title: string, style: StyleFn): string {
  return title ? pc.underline(style(title)) : "";
}

/**
 * Renders tabular data as styled text instead of a bordered (ASCII/box-drawing)
 * table: bold + underlined headings, colored fields, italic long values, and
 * plain space alignment.
 *
 * A single row is rendered as a vertical "Key  Value" list, which reads much
 * better for previews with long fields (URLs, descriptions, filenames).
 */
export function renderTable(
  data: Array<Record<string, unknown>>,
  options: ShowTableOptions = {},
): string {
  if (data.length === 0) return "";

  const theme = options.theme ?? DEFAULT_TABLE_THEME;
  const ignoreKeys = new Set(options.ignoreKeys ?? []);
  const keys = Object.keys(data[0] ?? {}).filter((key) => !ignoreKeys.has(key));
  if (keys.length === 0) return "";

  const heading = renderTitle(options.title ?? "", theme.titleStyle);
  const single = data.length === 1;

  const lines: string[] = [];
  if (single) {
    const row = data[0] ?? {};
    const keyWidth = Math.min(MAX_CELL_WIDTH, Math.max(...keys.map((key) => key.length)));
    for (const [index, key] of keys.entries()) {
      const style = theme.columnStyles[index % theme.columnStyles.length] as StyleFn;
      const raw = row[key] === undefined || row[key] === null ? "" : String(row[key]);
      const label = pc.underline(pc.bold(style(key)));
      lines.push(`  ${pad(label, keyWidth)}  ${styleValue(raw, style)}`);
    }
  } else {
    const widths = keys.map((key, index) => {
      const values = data.map((row) =>
        row[key] === undefined || row[key] === null ? "" : String(row[key]),
      );
      const longest = Math.max(key.length, ...values.map((value) => value.length));
      // The last column may run over; earlier columns are capped so the row stays readable.
      return index === keys.length - 1 ? longest : Math.min(MAX_CELL_WIDTH, longest);
    });

    lines.push(
      keys
        .map((key, index) => {
          const style = theme.columnStyles[index % theme.columnStyles.length] as StyleFn;
          const heading = pc.underline(pc.bold(style(key)));
          return pad(heading, widths[index] as number);
        })
        .join("  ")
        .trimEnd(),
    );

    for (const row of data) {
      lines.push(
        keys
          .map((key, index) => {
            const style = theme.columnStyles[index % theme.columnStyles.length] as StyleFn;
            const raw = row[key] === undefined || row[key] === null ? "" : String(row[key]);
            const width = widths[index] as number;
            const value = index === keys.length - 1 ? raw : truncate(raw, width);
            return pad(styleValue(value, style), width);
          })
          .join("  ")
          .trimEnd(),
      );
    }
  }

  const body = lines.join("\n");
  return heading ? `\n${heading}\n\n${body}` : `\n${body}`;
}

// Backwards-friendly alias used by the app layer.
export const showTable = renderTable;
