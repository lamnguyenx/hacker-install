import { basename, dirname, join, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import { download } from "./download.ts";
import { BunExecRunner, type ExecRunner } from "./exec.ts";
import { detectFileKindFromPath, isExecutableFile } from "./filetype.ts";
import { ensureDir, writeBytes } from "./fs-utils.ts";
import type { HttpClient } from "./http.ts";
import { createLogger, type Logger } from "./logger.ts";
import { errorMessage } from "./utils.ts";

export interface ExtractOptions {
  exec?: ExecRunner;
  logger?: Logger;
}

export interface ExtractUrlOptions extends ExtractOptions {
  http: HttpClient;
  progress?: boolean;
}

function lowerName(path: string): string {
  return basename(path).toLowerCase();
}

function isTarName(path: string): boolean {
  const name = lowerName(path);
  return (
    name.endsWith(".tar") ||
    name.endsWith(".tar.gz") ||
    name.endsWith(".tgz") ||
    name.endsWith(".tar.bz2") ||
    name.endsWith(".tbz") ||
    name.endsWith(".tbz2") ||
    name.endsWith(".tar.xz") ||
    name.endsWith(".txz") ||
    name.endsWith(".tar.zst") ||
    name.endsWith(".pkg.tar.zst")
  );
}

function stripCompressionSuffix(path: string): string {
  const name = basename(path);
  for (const suffix of [".gz", ".bz2", ".xz", ".zst"]) {
    if (name.toLowerCase().endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return `${name}.out`;
}

async function extractTar(bytes: Uint8Array, at: string): Promise<void> {
  const archive = new Bun.Archive(bytes);
  await archive.extract(at);
}

async function extractZip(bytes: Uint8Array, at: string): Promise<void> {
  const root = resolve(at);
  const files = unzipSync(bytes);
  for (const [entryName, data] of Object.entries(files)) {
    const target = resolve(root, entryName);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new Error(`Unsafe path in zip archive: ${entryName}`);
    }
    if (entryName.endsWith("/")) {
      continue;
    }
    await ensureDir(dirname(target), 0o700);
    await Bun.write(target, data);
  }
}

async function decompressCommand(
  exec: ExecRunner,
  command: string,
  path: string,
): Promise<Uint8Array> {
  const result = await exec.captureBytes([command, "-dc", path]);
  if (result.code !== 0) {
    throw new Error(`${command} failed: ${result.stderrText.trim()}`);
  }
  return result.stdout;
}

export async function extract(
  path: string,
  at: string,
  options: ExtractOptions = {},
): Promise<boolean> {
  const logger = options.logger ?? createLogger("info");
  const exec = options.exec ?? new BunExecRunner();

  try {
    await ensureDir(at, 0o700);
    const kind = await detectFileKindFromPath(path);
    const name = lowerName(path);
    logger.debug(`Extracting ${JSON.stringify(path)} (kind: ${kind})`);

    if (kind === "javascript") return true;

    if (kind === "7z") {
      const result = await exec.runArgs(["7z", "x", path, `-o${at}`]);
      if (result.code !== 0) {
        throw new Error(`7z failed: ${result.stderrText.trim()}`);
      }
      return true;
    }

    if (kind === "gzip") {
      const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
      if (isTarName(path)) {
        await extractTar(bytes, at);
      } else {
        const output = join(at, stripCompressionSuffix(path));
        await writeBytes(output, Bun.gunzipSync(bytes));
      }
      return true;
    }

    if (kind === "bzip2") {
      const bytes = await decompressCommand(exec, "bzip2", path);
      if (isTarName(path)) {
        await extractTar(bytes, at);
      } else {
        await writeBytes(join(at, stripCompressionSuffix(path)), bytes);
      }
      return true;
    }

    if (kind === "xz") {
      const bytes = await decompressCommand(exec, "xz", path);
      if (isTarName(path)) {
        await extractTar(bytes, at);
      } else {
        await writeBytes(join(at, stripCompressionSuffix(path)), bytes);
      }
      return true;
    }

    if (kind === "zstd") {
      const compressed = new Uint8Array(await Bun.file(path).arrayBuffer());
      const bytes = Bun.zstdDecompressSync(compressed);
      if (isTarName(path)) {
        await extractTar(bytes, at);
      } else {
        await writeBytes(join(at, stripCompressionSuffix(path)), bytes);
      }
      return true;
    }

    if (kind === "zip") {
      const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
      await extractZip(bytes, at);
      return true;
    }

    if (kind === "tar") {
      const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
      await extractTar(bytes, at);
      return true;
    }

    // Last chance: some archives have unusual headers. Let Bun try to read it.
    try {
      const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
      await extractTar(bytes, at);
      return true;
    } catch (error) {
      throw new Error(`Invalid file (${name}): ${errorMessage(error)}`);
    }
  } catch (error) {
    logger.error(`Can't extract ${JSON.stringify(path)}: ${errorMessage(error)}`);
    throw new Error("Invalid file", { cause: error });
  }
}

export async function extractUrl(
  url: string,
  at: string,
  options: ExtractUrlOptions,
): Promise<boolean> {
  const logger = options.logger ?? createLogger("info");
  const path = await download(url, at, {
    http: options.http,
    logger,
    progress: options.progress,
  });
  logger.debug(`Downloaded: ${path}`);
  if (!(await isExecutableFile(path))) {
    await extract(path, at, { exec: options.exec, logger });
    logger.debug("Extraction done.");
  }
  return true;
}
