import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function expandHome(value: string, home = homedir()): string {
  if (value === "~") return home;
  if (value.startsWith("~/")) return join(home, value.slice(2));
  return value;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function lexists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function ensureDir(path: string, mode = 0o700): Promise<void> {
  await mkdir(path, { recursive: true, mode });
}

export async function readlinkOrNull(path: string): Promise<string | null> {
  try {
    return await readlink(path);
  } catch {
    return null;
  }
}

export async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeTextAtomic(path: string, content: string, mode = 0o600): Promise<void> {
  await ensureDir(dirname(path), 0o700);
  const suffix = randomBytes(6).toString("hex");
  const temp = `${path}.${process.pid}.${suffix}.tmp`;
  try {
    await writeFile(temp, content, { encoding: "utf8", mode });
    await chmod(temp, mode);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeBytes(path: string, bytes: Uint8Array, mode?: number): Promise<void> {
  await ensureDir(dirname(path), 0o700);
  await writeFile(path, bytes, mode === undefined ? undefined : { mode });
  if (mode !== undefined) await chmod(path, mode);
}

export async function createTempDir(parent: string, prefix: string): Promise<string> {
  await ensureDir(parent, 0o700);
  const path = join(parent, `${prefix}${randomBytes(6).toString("hex")}`);
  await mkdir(path, { recursive: true, mode: 0o700 });
  return path;
}

export async function removePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function chmodIfExists(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

export { chmod };
