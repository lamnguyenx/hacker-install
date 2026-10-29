import { open, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ExecRunner } from "./exec.ts";
import { ensureDir } from "./fs-utils.ts";
import { type HttpClient, HttpError, USER_AGENT } from "./http.ts";
import { createLogger, type Logger } from "./logger.ts";
import { ProgressBar } from "./ui/progress.ts";
import { sleep } from "./utils.ts";

export const DOWNLOAD_MAX_RETRIES = 5;
/** aria2 splits the file into this many connections by default. */
export const DOWNLOAD_CONNECTIONS = 8;

export interface DownloadOptions {
  http: HttpClient;
  logger?: Logger;
  progress?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
  /**
   * When provided, aria2c is used if it is installed: multi-connection
   * segmented download with resume support. Falls back to the built-in
   * resumable downloader when aria2c is missing or fails.
   */
  exec?: ExecRunner;
  /** Parallel connections for aria2c (defaults to 8). */
  connections?: number;
}

function safeFileName(name: string): string {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    return "download";
  }
  return name;
}

function fileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
    if (name) return safeFileName(basename(name));
  } catch {
    // fall through to the string split below
  }
  const name = url.split("/").pop() ?? "download";
  return safeFileName(basename(name.split("?")[0] ?? "download"));
}

async function isAria2Available(exec: ExecRunner): Promise<boolean> {
  try {
    const result = await exec.runArgs(["aria2c", "--version"]);
    return result.code === 0 && /aria2/i.test(result.stdoutText);
  } catch {
    return false;
  }
}

/** Best-effort size lookup so aria2c's progress polling can show a percentage. */
async function probeContentLength(url: string, http: HttpClient): Promise<number> {
  const controller = new AbortController();
  try {
    const response = await http.get(url, {
      headers: { Range: "bytes=0-0" },
      signal: controller.signal,
      timeoutMs: 15_000,
    });
    if (response.status === 206) {
      const match = /bytes\s+\d+-\d+\/(\d+)/i.exec(response.headers.get("content-range") ?? "");
      if (match?.[1]) return Number(match[1]) || 0;
    }
    const length = Number(response.headers.get("content-length") ?? 0);
    return Number.isFinite(length) && length > 0 ? length : 0;
  } catch {
    return 0;
  } finally {
    controller.abort();
  }
}

/**
 * Download through aria2c: `-x/-s 8` connections, `--continue` for resume.
 * aria2c runs quietly; progress is polled from the file size so we can draw
 * our own width-clamped single-line bar instead of aria2c's multi-line output.
 */
async function downloadWithAria2(
  url: string,
  outputPath: string,
  fileName: string,
  at: string,
  options: DownloadOptions,
  logger: Logger,
  exec: ExecRunner,
  total: number,
): Promise<boolean> {
  const connections = Math.max(1, Math.min(16, options.connections ?? DOWNLOAD_CONNECTIONS));
  const progress = new ProgressBar({
    label: `Downloading ${fileName}`,
    total,
    enabled: options.progress ?? Boolean(process.stderr.isTTY),
  });

  const args = [
    "aria2c",
    "--continue=true",
    "--allow-overwrite=true",
    "--auto-file-renaming=false",
    `--max-connection-per-server=${connections}`,
    `--split=${connections}`,
    "--min-split-size=1M",
    "--file-allocation=none",
    "--console-log-level=warn",
    "--summary-interval=0",
    "--download-result=hide",
    "--show-console-readout=false",
    `--user-agent=${USER_AGENT}`,
    `--dir=${at}`,
    `--out=${fileName}`,
    url,
  ];

  const timer = setInterval(() => {
    void stat(outputPath).then(
      (info) => {
        if (total > 0 && info.size >= total) return;
        progress.update(info.size);
      },
      () => undefined,
    );
  }, 120);

  try {
    const result = await exec.runArgs(args, { interactive: true });
    const size = await stat(outputPath).then(
      (info) => info.size,
      () => 0,
    );
    if (result.code !== 0) {
      logger.warn(`aria2c exited with code ${result.code}`);
      return false;
    }
    if (size === 0) {
      logger.warn("aria2c reported success but the file is empty");
      return false;
    }
    if (total > 0 && size < total) {
      logger.warn(`aria2c stopped at ${size}/${total} bytes`);
      return false;
    }
    progress.update(size);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`aria2c failed: ${message}`);
    return false;
  } finally {
    clearInterval(timer);
    progress.finish();
  }
}

export async function download(url: string, at: string, options: DownloadOptions): Promise<string> {
  const logger = options.logger ?? createLogger("info");
  const maxRetries = options.maxRetries ?? DOWNLOAD_MAX_RETRIES;
  const fileName = fileNameFromUrl(url);
  const outputPath = join(at, fileName);
  await ensureDir(at, 0o700);

  if (options.exec && (await isAria2Available(options.exec))) {
    logger.debug(`Using aria2c (${options.connections ?? DOWNLOAD_CONNECTIONS} connections)`);
    const total = await probeContentLength(url, options.http);
    if (
      await downloadWithAria2(url, outputPath, fileName, at, options, logger, options.exec, total)
    ) {
      logger.info(`Downloaded: '${fileName}' at ${at}`);
      return outputPath;
    }
    logger.warn(`Falling back to the built-in downloader for '${fileName}'`);
  }

  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(outputPath, "r+");
  } catch {
    handle = await open(outputPath, "w+");
  }
  let progress: ProgressBar | null = null;
  let position = (await handle.stat()).size;

  try {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const headers: Record<string, string> = {};
      if (position > 0) headers.Range = `bytes=${position}-`;

      try {
        const response = await options.http.get(url, { headers, timeoutMs: 0 });

        if (response.status === 416 && position > 0) {
          logger.debug(`Server reports the file is already complete: ${fileName}`);
          break;
        }
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new HttpError(url, response.status, body);
        }

        if (position > 0 && response.status !== 206) {
          position = 0;
          await handle.truncate(0);
        }

        const contentLength = Number(response.headers.get("content-length") ?? 0);
        const total = contentLength > 0 ? contentLength + position : 0;
        if (!progress) {
          progress = new ProgressBar({
            label: `Downloading ${fileName}`,
            total,
            enabled: options.progress ?? Boolean(process.stderr.isTTY),
          });
        }
        progress.update(position);

        if (!response.body) throw new Error("Response body is empty");
        for await (const chunk of response.body) {
          const bytes = chunk as Uint8Array;
          if (bytes.length === 0) continue;
          await handle.write(bytes, 0, bytes.length, position);
          position += bytes.length;
          progress.update(position);
        }

        break;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (attempt === maxRetries) throw error;
        await handle.sync().catch(() => undefined);
        const name = error instanceof Error ? error.name : "Error";
        logger.warn(
          `Download interrupted (${name}); resuming from ${position} bytes ` +
            `(attempt ${attempt}/${maxRetries - 1})`,
        );
        const delay =
          options.retryDelayMs !== undefined ? options.retryDelayMs : 2 ** (attempt - 1) * 1000;
        if (delay > 0) await sleep(delay);
      }
    }
  } finally {
    progress?.finish();
    await handle.close();
  }

  logger.info(`Downloaded: '${fileName}' at ${at}`);
  return outputPath;
}
