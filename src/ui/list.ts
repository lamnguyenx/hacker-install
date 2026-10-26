import pc from "picocolors";

export interface ToolListEntry {
  name: string;
  version: string;
  type: string;
  provider: string;
  hold: boolean;
  source: string;
  description: string;
}

export interface ToolListOptions {
  title?: string;
  /** Wrap width in columns. 0 (or omitted) disables truncation, e.g. when piping. */
  width?: number;
}

const INDENT = "  ";
const SEPARATOR = " · ";

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Visible width in code points, ignoring ANSI escape sequences. */
export function textWidth(value: string): number {
  return [...value.replace(ANSI_PATTERN, "")].length;
}

export function terminalWidth(fallback = 80): number {
  const columns = process.stdout.columns;
  if (typeof columns === "number" && Number.isFinite(columns) && columns > 0) return columns;
  const env = Number.parseInt(process.env.COLUMNS ?? "", 10);
  if (Number.isFinite(env) && env > 0) return env;
  return fallback;
}

function truncate(value: string, max: number): string {
  if (max <= 0) return "";
  const chars = [...value];
  if (chars.length <= max) return value;
  if (max === 1) return "…";
  const head = chars
    .slice(0, max - 1)
    .join("")
    .trimEnd();
  return `${head}…`;
}

interface Segment {
  text: string;
  style?: (value: string) => string;
  /** Skip the segment entirely when fewer columns than this are left. */
  minWidth?: number;
}

/**
 * Joins styled segments with a dim separator, dropping the ones that no longer
 * fit. The first segment is truncated if needed; `truncateTail` also truncates
 * the last segment (used for descriptions).
 */
function packLine(segments: Segment[], max: number, truncateTail: boolean): string {
  let line = INDENT;
  let used = INDENT.length;
  let rendered = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] as Segment;
    const separator = rendered === 0 ? "" : SEPARATOR;
    const separatorWidth = rendered === 0 ? 0 : textWidth(SEPARATOR);
    const available = max > 0 ? max - used - separatorWidth : Number.POSITIVE_INFINITY;
    if (available <= 0) break;

    const isLast = index === segments.length - 1;
    if (textWidth(segment.text) > available) {
      if (rendered === 0 || (truncateTail && isLast)) {
        if (segment.minWidth !== undefined && available < segment.minWidth) break;
        const text = truncate(segment.text, available);
        if (text) {
          line += separator + (segment.style ?? ((value: string) => value))(text);
        }
      }
      break;
    }

    line += separator + (segment.style ?? ((value: string) => value))(segment.text);
    used += separatorWidth + textWidth(segment.text);
    rendered += 1;
  }

  return line;
}

function formatSource(source: string): string {
  return source.replace(/^https?:\/\//, "").replace(/\.git$/, "");
}

function providerLabel(provider: string): string {
  return provider.replace(/-self$/, "");
}

export function renderToolList(entries: ToolListEntry[], options: ToolListOptions = {}): string {
  const width = options.width ?? 0;
  const title = options.title ?? "Installed tools";
  const header = `${pc.bold(pc.underline(pc.cyan(title)))} ${pc.dim(`(${entries.length})`)}`;

  const blocks = entries.map((entry) => {
    const tags: Segment[] = [
      { text: entry.name, style: (value) => pc.bold(pc.cyan(value)) },
      { text: entry.version, style: pc.green },
      { text: entry.type, style: entry.type === "binary" ? pc.dim : (value) => pc.cyan(value) },
      { text: providerLabel(entry.provider), style: pc.dim },
    ];
    if (entry.hold) {
      tags.push({ text: "held", style: (value) => pc.bold(pc.yellow(value)) });
    }

    const lines = [packLine(tags, width, false)];

    const details: Segment[] = [];
    const source = formatSource(entry.source);
    if (source) {
      details.push({ text: source, style: (value) => pc.underline(pc.dim(value)) });
    }
    if (entry.description) {
      details.push({
        text: entry.description,
        style: (value) => pc.italic(pc.dim(value)),
        minWidth: 16,
      });
    }
    if (details.length > 0) {
      lines.push(packLine(details, width, true));
    }

    return lines.join("\n");
  });

  return [header, "", blocks.join("\n\n")].join("\n");
}
