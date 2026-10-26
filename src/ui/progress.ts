export interface ProgressOptions {
  label: string;
  total?: number;
  enabled?: boolean;
  sink?: (text: string) => void;
  now?: () => number;
}

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

export class ProgressBar {
  private readonly label: string;
  private readonly total: number;
  private readonly enabled: boolean;
  private readonly sink: (text: string) => void;
  private readonly now: () => number;
  private readonly startedAt: number;
  private lastDrawn = "";
  private finished = false;

  constructor(options: ProgressOptions) {
    this.label = options.label;
    this.total = options.total && options.total > 0 ? options.total : 0;
    this.enabled = options.enabled ?? Boolean(process.stderr.isTTY);
    this.sink = options.sink ?? ((text) => process.stderr.write(text));
    this.now = options.now ?? (() => Date.now());
    this.startedAt = this.now();
  }

  update(downloaded: number): void {
    if (!this.enabled || this.finished) return;
    const elapsed = Math.max(0.001, (this.now() - this.startedAt) / 1000);
    const speed = downloaded / elapsed;
    const ratio = this.total > 0 ? Math.min(1, downloaded / this.total) : 0;
    const width = 24;
    const filled = Math.round(ratio * width);
    const bar = `${"━".repeat(filled)}${"─".repeat(width - filled)}`;
    const percent = this.total > 0 ? `${String(Math.round(ratio * 100)).padStart(3)}%` : "  ?%";
    const amount =
      this.total > 0
        ? `${formatBytes(downloaded)}/${formatBytes(this.total)}`
        : formatBytes(downloaded);
    const eta =
      this.total > 0 ? formatEta((this.total - downloaded) / Math.max(1, speed)) : "--:--";
    const line = `${this.label} ${bar} ${percent} ${amount} ${formatBytes(speed)}/s ETA ${eta}`;
    this.draw(line);
  }

  finish(): void {
    if (!this.enabled || this.finished) return;
    this.finished = true;
    this.sink("\r\x1b[2K");
  }

  private draw(line: string): void {
    if (line === this.lastDrawn) return;
    this.lastDrawn = line;
    this.sink(`\r\x1b[2K${line}`);
  }
}
