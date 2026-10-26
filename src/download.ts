import { open } from "node:fs/promises";
import { basename, join } from "node:path";
import { ensureDir } from "./fs-utils.ts";
import { type HttpClient, HttpError } from "./http.ts";
import { createLogger, type Logger } from "./logger.ts";
import { ProgressBar } from "./ui/progress.ts";
import { sleep } from "./utils.ts";

export const DOWNLOAD_MAX_RETRIES = 5;

export interface DownloadOptions {
  http: HttpClient;
  logger?: Logger;
  progress?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
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

export async function download(url: string, at: string, options: DownloadOptions): Promise<string> {
  const logger = options.logger ?? createLogger("info");
  const maxRetries = options.maxRetries ?? DOWNLOAD_MAX_RETRIES;
  const fileName = fileNameFromUrl(url);
  const outputPath = join(at, fileName);
  await ensureDir(at, 0o700);

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
