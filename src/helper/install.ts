import type { Dirent } from "node:fs";
import { copyFile, cp, readdir, rename, stat, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { BunExecRunner, type ExecRunner } from "../exec.ts";
import { isInstallCandidate } from "../filetype.ts";
import {
  chmod,
  ensureDir,
  expandHome,
  isExecutable,
  isSymlink,
  lexists,
  removePath,
  unlinkIfExists,
} from "../fs-utils.ts";
import { createLogger, type Logger } from "../logger.ts";
import { requireSupportedPlatform } from "../platform.ts";

export interface InstallBinOptions {
  local?: boolean;
  name?: string;
  skipExtensions?: string[];
  bundleRoot?: string;
  exec?: ExecRunner;
  logger?: Logger;
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        files.push(full);
      } else if (entry.isSymbolicLink()) {
        const resolved = await stat(full).catch(() => null);
        if (resolved?.isFile()) files.push(full);
      }
    }
  }

  return files;
}

async function movePath(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await cp(source, target, { recursive: true, force: true, errorOnExist: false });
    await removePath(source);
  }
}

async function findBundleLauncher(src: string, name: string): Promise<string | null> {
  const candidates = [join(src, "bin", name)];
  let children: string[] = [];
  try {
    children = (await readdir(src, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(src, entry.name));
  } catch {
    return null;
  }
  for (const child of children) candidates.push(join(child, "bin", name));

  const matches: string[] = [];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) matches.push(candidate);
    } catch {
      // not a launcher
    }
  }
  return matches.length === 1 ? (matches[0] as string) : null;
}

async function installBundle(
  launcher: string,
  dest: string,
  name: string,
  bundleRoot: string,
  local: boolean,
  exec: ExecRunner,
  logger: Logger,
): Promise<boolean> {
  const packageDir = dirname(dirname(launcher));
  const target = join(expandHome(bundleRoot), name);

  if (await lexists(target)) {
    if ((await isSymlink(target)) || !(await stat(target).catch(() => null))?.isDirectory()) {
      await unlinkIfExists(target);
    } else {
      await removePath(target);
    }
  }
  await ensureDir(target, 0o700);

  for (const entry of await readdir(packageDir, { withFileTypes: true })) {
    await movePath(join(packageDir, entry.name), join(target, entry.name));
  }

  const installed = join(target, "bin", name);
  await chmod(installed, 0o755);

  const link = join(expandHome(dest), name);
  await ensureDir(dirname(link), 0o700);

  if (!local) {
    const result = await exec.runArgs(["sudo", "ln", "-sfn", installed, link], {
      interactive: true,
    });
    if (result.code !== 0) {
      logger.error(result.stderrText.trim() || `Failed to create symlink: ${link}`);
      return false;
    }
  } else {
    await unlinkIfExists(link);
    await symlink(installed, link);
  }

  logger.info(`Installed: ${name} -> ${installed}`);
  return true;
}

async function installBinary(
  source: string,
  dest: string,
  name: string,
  local: boolean,
  exec: ExecRunner,
  logger: Logger,
): Promise<boolean> {
  requireSupportedPlatform();
  const target = name ? join(expandHome(dest), name) : join(expandHome(dest), basename(source));
  const command = `install ${source} ${target}`;
  logger.info(command);

  if (local) {
    await ensureDir(dirname(target), 0o700);
    await copyFile(source, target);
    await chmod(target, 0o755);
    logger.info(`Installed: ${name || basename(target)}`);
    return true;
  }

  const result = await exec.runArgs(["sudo", "install", source, target], {
    interactive: true,
  });
  if (result.code !== 0) {
    logger.error(result.stderrText.trim());
    return false;
  }
  logger.info(`Installed: ${name || basename(target)}`);
  return true;
}

export async function installBin(
  src: string,
  dest: string,
  options: InstallBinOptions = {},
): Promise<boolean> {
  const logger = options.logger ?? createLogger("info");
  const exec = options.exec ?? new BunExecRunner();
  const local = options.local ?? true;
  const name = options.name;
  const bundleRoot = options.bundleRoot ?? join(homedir(), "Downloads2");

  if (name) {
    const launcher = await findBundleLauncher(src, name);
    if (launcher) {
      return installBundle(launcher, dest, name, bundleRoot, local, exec, logger);
    }
  }

  const skipExtensions = new Set(
    (options.skipExtensions ?? ["ts"]).map((extension) =>
      extension.toLowerCase().replace(/^\./, ""),
    ),
  );

  const binFiles: string[] = [];
  const files = await walkFiles(src);

  for (const file of files) {
    const extension = extname(file).toLowerCase().replace(/^\./, "");
    if (skipExtensions.has(extension)) {
      logger.debug(`Skipping script file: ${file}`);
      continue;
    }

    let candidate = false;
    try {
      candidate = await isInstallCandidate(file);
    } catch (error) {
      logger.debug(`Skipping unreadable file ${file}: ${(error as Error).message}`);
      continue;
    }
    if (!candidate) {
      if (extension === "js" || extension === "ts") {
        logger.debug(`Skipping non-runnable .${extension} (no node shebang): ${file}`);
      }
      continue;
    }

    if (!(await isExecutable(file))) {
      try {
        await chmod(file, 0o755);
        logger.debug(`Made file executable: ${file}`);
      } catch (error) {
        logger.error(`Failed to make file executable: ${error}`);
        continue;
      }
    }

    binFiles.push(file);
  }

  if (binFiles.length > 1 && name) {
    const named = binFiles.filter((file) => basename(file) === name);
    if (named.length === 1) {
      binFiles.length = 0;
      binFiles.push(named[0] as string);
    }
  }

  if (binFiles.length !== 1) {
    logger.error(`Expected a single binary, found: [${binFiles.join(", ")}]`);
    return false;
  }

  return installBinary(binFiles[0] as string, dest, name ?? "", local, exec, logger);
}

export { extractUrl } from "../extract.ts";
