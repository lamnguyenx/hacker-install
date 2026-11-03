export interface ProgressOptions {
  label: string;
  total?: number;
  enabled?: boolean;
  sink?: (text: string) => void;
  now?: () => number;
  /** Terminal width in columns. Read fresh on every draw so it follows resizes. */
  width?: () => number;
}

const MIN_BAR_WIDTH = 8;
const MAX_BAR_WIDTH = 24;
const REDRAW_INTERVAL_MS = 80;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/** Shorten `text` to `max` columns, keeping the start and the end. */
function ellipsize(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…".slice(0, Math.max(0, max));
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${text.slice(0, head)}…${tail > 0 ? text.slice(-tail) : ""}`;
}

export class ProgressBar {
  private readonly label: string;
  private readonly total: number;
  private readonly enabled: boolean;
  private readonly sink: (text: string) => void;
  private readonly now: () => number;
  private readonly width: () => number;
  private readonly startedAt: number;
  private lastDrawn = "";
  private lastDrawnAt = 0;
  private completed = false;
  private finished = false;

  constructor(options: ProgressOptions) {
    this.label = options.label;
    this.total = options.total && options.total > 0 ? options.total : 0;
    this.enabled = options.enabled ?? Boolean(process.stderr.isTTY);
    this.sink = options.sink ?? ((text) => process.stderr.write(text));
    this.now = options.now ?? (() => Date.now());
    this.width = options.width ?? (() => process.stderr.columns ?? process.stdout.columns ?? 80);
    this.startedAt = this.now();
  }

  update(downloaded: number): void {
    if (!this.enabled || this.finished) return;
    const now = this.now();
    const complete = this.total > 0 && downloaded >= this.total;
    if (complete) {
      // Draw 100% exactly once; aria2 can keep the file at full size for a
      // while during finalisation and redrawing would only churn the line.
      if (this.completed) return;
      this.completed = true;
    } else if (this.lastDrawn && now - this.lastDrawnAt < REDRAW_INTERVAL_MS) {
      return;
    }
    this.lastDrawnAt = now;

    const elapsed = Math.max(0.001, (now - this.startedAt) / 1000);
    const speed = Math.max(0, downloaded / elapsed);
    const ratio = this.total > 0 ? Math.min(1, downloaded / this.total) : 0;
    const percent = this.total > 0 ? `${String(Math.round(ratio * 100)).padStart(3)}%` : "  ?%";
    const amount =
      this.total > 0
        ? `${formatBytes(downloaded)}/${formatBytes(this.total)}`
        : formatBytes(downloaded);
    const eta =
      this.total > 0 ? formatEta((this.total - downloaded) / Math.max(1, speed)) : "--:--";

    this.draw(
      this.compose(ratio, [
        ` ${percent} ${amount} ${formatBytes(speed)}/s ETA ${eta}`,
        ` ${percent} ${amount} ${formatBytes(speed)}/s`,
        ` ${percent} ${amount}`,
        ` ${percent}`,
      ]),
    );
  }

  finish(): void {
    if (!this.enabled || this.finished) return;
    this.finished = true;
    if (!this.lastDrawn) return;
    this.lastDrawn = "";
    this.sink("\x1b[1A\x1b[2K");
  }

  /**
   * Build a line that fits the terminal. If the cursor ever reaches the last
   * column the terminal wraps to a new row, and `\r\x1b[2K` only clears that
   * new row — leaving a trail of half-drawn bars behind. So lines must stay
   * strictly narrower than the terminal, not merely fit.
   *
   * `tails` is ordered from most to least detailed; the first tail that leaves
   * room for the full label and at least a minimum-width bar wins.
   */
  private compose(ratio: number, tails: string[]): string {
    const reported = this.width();
    const columns = Number.isFinite(reported) && reported > 1 ? reported : 80;
    const width = columns - 1;

    for (const tail of tails) {
      const full = this.label.length + 1 + MAX_BAR_WIDTH + tail.length;
      if (full <= width) return this.render(this.label, MAX_BAR_WIDTH, tail, ratio);

      const barWidth = width - tail.length - 1 - this.label.length;
      if (barWidth >= Math.min(MIN_BAR_WIDTH, width)) {
        return this.render(this.label, Math.min(MAX_BAR_WIDTH, barWidth), tail, ratio);
      }
    }

    // Even the shortest tail leaves no room for the label: ellipsize it and
    // keep a modest bar so the line still communicates progress.
    const tail = tails[tails.length - 1] as string;
    const barWidth = Math.max(1, Math.min(MAX_BAR_WIDTH, Math.floor(width / 3)));
    const label = ellipsize(this.label, Math.max(1, width - (tail.length + 1 + barWidth)));
    const line = this.render(label, barWidth, tail, ratio);
    return line.length > width ? line.slice(0, width) : line;
  }

  private render(label: string, barWidth: number, tail: string, ratio: number): string {
    const filled = Math.round(ratio * barWidth);
    const bar = `${"━".repeat(filled)}${"─".repeat(barWidth - filled)}`;
    return `${label} ${bar}${tail}`;
  }

  private draw(line: string): void {
    if (line === this.lastDrawn) return;
    // Each frame ends with a newline and the next frame walks back up one row
    // instead of relying on `\r`. Terminals, pty wrappers and log renderers
    // that translate carriage returns into line breaks would otherwise print
    // every update on its own line. ANSI cursor-up works in all of them.
    const prefix = this.lastDrawn === "" ? "" : "\x1b[1A\x1b[2K";
    this.lastDrawn = line;
    this.sink(`${prefix}${line}\n`);
  }
}
