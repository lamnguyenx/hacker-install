import Table from "cli-table3";
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

const TABLE_CHARS = {
  top: "━",
  "top-mid": "┳",
  "top-left": "┏",
  "top-right": "┓",
  bottom: "─",
  "bottom-mid": "┴",
  "bottom-left": "└",
  "bottom-right": "┘",
  left: "│",
  "left-mid": "┡",
  mid: "━",
  "mid-mid": "╇",
  right: "│",
  "right-mid": "┩",
  middle: "│",
} as const;

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function visibleLength(value: string): number {
  // string-width handles unicode and ANSI in cli-table3; this is only used for
  // title centering and simple width hints.
  return value.replace(ANSI_PATTERN, "").length;
}

function renderTitle(title: string, width: number, style: StyleFn): string {
  if (!title) return "";
  const text = style(title);
  const padding = Math.max(0, Math.floor((width - visibleLength(title)) / 2));
  return `\n${" ".repeat(padding)}${text}`;
}

export function renderTable(
  data: Array<Record<string, unknown>>,
  options: ShowTableOptions = {},
): string {
  if (data.length === 0) return "";

  const theme = options.theme ?? DEFAULT_TABLE_THEME;
  const ignoreKeys = new Set(options.ignoreKeys ?? []);
  const keys = Object.keys(data[0] ?? {}).filter((key) => !ignoreKeys.has(key));

  const table = new Table({
    head: keys.map((key, index) => {
      const style = theme.columnStyles[index % theme.columnStyles.length] as StyleFn;
      return style(key);
    }),
    chars: TABLE_CHARS,
    wordWrap: !options.noWrap,
    wrapOnWordBoundary: true,
    style: {
      head: [],
      border: [],
      "padding-left": 1,
      "padding-right": 1,
    },
  });

  for (const row of data) {
    table.push(
      keys.map((key, index) => {
        const style = theme.columnStyles[index % theme.columnStyles.length] as StyleFn;
        const value = row[key] === undefined || row[key] === null ? "" : String(row[key]);
        return style(value);
      }),
    );
  }

  const rendered = table.toString();
  const firstLine = rendered.split("\n")[0] ?? "";
  const title = renderTitle(options.title ?? "", visibleLength(firstLine), theme.titleStyle);
  const body = firstLine ? rendered : "";
  return `${title}${body ? `\n${theme.tableStyle(body)}` : ""}`;
}

// Backwards-friendly alias used by the app layer.
export const showTable = renderTable;
