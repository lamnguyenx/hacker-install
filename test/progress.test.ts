import { afterEach, describe, expect, test } from "bun:test";
import { ProgressBar } from "../src/ui/progress.ts";

const sinks: string[] = [];

afterEach(() => {
  sinks.length = 0;
});

function ticker(step = 1000): () => number {
  let time = 0;
  return () => {
    time += step;
    return time;
  };
}

function draw(options: {
  width: number;
  total?: number;
  update?: (bar: ProgressBar) => void;
}): string[] {
  const bar = new ProgressBar({
    label: "Downloading code-server-4.143.1-linux-amd64.tar.gz",
    total: options.total ?? 219 * 1024 * 1024,
    enabled: true,
    sink: (text) => sinks.push(text),
    width: () => options.width,
    now: ticker(),
  });
  options.update?.(bar);
  bar.finish();
  return sinks;
}

const CURSOR_UP = "\x1b[1A\x1b[2K";

function frameText(frame: string): string {
  const body = frame.startsWith(CURSOR_UP) ? frame.slice(CURSOR_UP.length) : frame;
  return body.endsWith("\n") ? body.slice(0, -1) : body;
}

describe("ProgressBar", () => {
  test("never draws a line as wide as the terminal", () => {
    // A line that fills the last column makes the terminal wrap; the next
    // \r\x1b[2K then clears the fresh row and leaves the previous one behind.
    for (const width of [16, 24, 40, 60, 80, 113, 120, 200]) {
      sinks.length = 0;
      const frames = draw({
        width,
        update: (bar) => {
          bar.update(5_600_000);
          bar.update(50_000_000);
          bar.update(219 * 1024 * 1024);
        },
      });
      const drawn = frames.map(frameText).filter((line) => line.length > 0);
      expect(drawn.length).toBeGreaterThan(0);
      for (const line of drawn) {
        expect(line.length).toBeLessThan(width);
      }
    }
  });

  test("draws the 100% frame once, even if updates keep arriving", () => {
    sinks.length = 0;
    const bar = new ProgressBar({
      label: "Downloading code-server-4.143.1-linux-amd64.tar.gz",
      total: 1000,
      enabled: true,
      sink: (text) => sinks.push(text),
      width: () => 113,
      now: ticker(),
    });
    bar.update(1000);
    bar.update(1000);
    bar.update(1000);
    bar.update(1000);
    bar.finish();
    const completed = sinks.filter((frame) => frameText(frame).includes("100%"));
    expect(completed).toHaveLength(1);
  });

  test("drops the ETA and speed before the label on narrow terminals", () => {
    sinks.length = 0;
    const frames = draw({ width: 50, update: (bar) => bar.update(10_000_000) });
    const line = frameText(frames[0] as string);
    expect(line).toMatch(/\d+%/);
    expect(line).not.toContain("ETA");
    expect(line).not.toContain("/s");
  });

  test("redraws in place with a newline and cursor-up", () => {
    sinks.length = 0;
    draw({
      width: 80,
      update: (bar) => {
        bar.update(1_000_000);
        bar.update(2_000_000);
      },
    });
    expect(sinks.length).toBeGreaterThan(1);
    expect(sinks[0]?.startsWith(CURSOR_UP)).toBe(false);
    expect(sinks[0]?.endsWith("\n")).toBe(true);
    for (const frame of sinks.slice(1, -1)) {
      expect(frame.startsWith(CURSOR_UP)).toBe(true);
      expect(frame.endsWith("\n")).toBe(true);
    }
    expect(sinks.at(-1)).toBe(CURSOR_UP);
  });

  test("does not redraw an unchanged line", () => {
    sinks.length = 0;
    draw({
      width: 80,
      update: (bar) => {
        bar.update(1_000_000);
        bar.update(1_000_000);
        bar.update(1_000_000);
      },
    });
    // one frame plus the clear-on-finish frame
    expect(sinks).toHaveLength(2);
  });

  test("draws nothing when disabled", () => {
    const bar = new ProgressBar({
      label: "Downloading",
      total: 10,
      enabled: false,
      sink: (text) => sinks.push(text),
    });
    bar.update(5);
    bar.finish();
    expect(sinks).toHaveLength(0);
  });
});
