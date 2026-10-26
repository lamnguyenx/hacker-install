import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureDir } from "../fs-utils.ts";
import { createLogger, type Logger } from "../logger.ts";

export interface PackageInstallerOptions {
  logger?: Logger;
}

export abstract class PackageInstallerABC {
  name: string;
  packageName: string;
  protected readonly logger: Logger;

  constructor(name: string, options: PackageInstallerOptions = {}) {
    this.name = name;
    this.packageName = name;
    this.logger = options.logger ?? createLogger("info");
    this.logger.debug(`Initializing ${this.constructor.name}: ${name}`);
  }

  abstract install(source: string): Promise<string | null>;
  abstract uninstall(): Promise<boolean>;
  abstract _extractPackage(source: string): Promise<string | null>;
  abstract _queryPackageName(source: string): Promise<string | null>;

  protected async _extractPackageBase(
    source: string,
    extension: string,
    label: string,
  ): Promise<string | null> {
    const sourcePath = await this.validateSource(source, extension);
    if (!sourcePath) return null;
    const actualName = await this._queryPackageName(sourcePath);
    if (actualName) {
      this.logger.debug(`${label} package name from metadata: ${actualName}`);
      this.packageName = actualName;
    }
    return sourcePath;
  }

  async validateSource(source: string, extension: string): Promise<string | null> {
    const sourcePath = resolve(source);
    try {
      if (!(await stat(sourcePath)).isFile()) {
        this.logger.error(`Source file does not exist: ${sourcePath}`);
        return null;
      }
    } catch {
      this.logger.error(`Source file does not exist: ${sourcePath}`);
      return null;
    }

    if (!sourcePath.toLowerCase().endsWith(extension.toLowerCase())) {
      this.logger.error(`Source file does not have ${extension} extension: ${sourcePath}`);
      return null;
    }

    return sourcePath;
  }

  async ensureDirectory(path: string): Promise<void> {
    await ensureDir(path, 0o700);
    this.logger.debug(`Ensured directory exists: ${path}`);
  }

  protected async readText(path: string): Promise<string> {
    return readFile(path, "utf8");
  }
}

export function parseIniValue(text: string, section: string, key: string): string | null {
  let current = "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      current = trimmed.slice(1, -1).trim();
      continue;
    }
    if (current !== section) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    if (trimmed.slice(0, separator).trim() === key) {
      return trimmed.slice(separator + 1).trim();
    }
  }
  return null;
}
