import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { BunExecRunner, type ExecRunner } from "../exec.ts";
import { createLogger, type Logger } from "../logger.ts";
import { detectOsPackageType, systemName } from "../platform.ts";
import { PACKAGE_TYPES, type PackageType } from "../schemas.ts";
import { AppImage } from "./appimage.ts";
import { PackageInstallerABC } from "./base.ts";
import { DebPackage } from "./deb.ts";
import { RpmPackage } from "./rpm.ts";

export function detectPackageTypeFromAssetName(name: string): PackageType | null {
  const extension = name.includes(".") ? (name.toLowerCase().split(".").pop() ?? "") : "";
  const normalized = extension === "appimage" ? "AppImage" : extension;
  return (PACKAGE_TYPES as readonly string[]).includes(normalized)
    ? (normalized as PackageType)
    : null;
}

export function detectPackageTypeFromOsRelease(
  logger: Logger = createLogger("info"),
): PackageType | null {
  const system = systemName();
  if (system !== "linux") {
    logger.debug("Native package installation is only supported on Linux");
    return null;
  }
  const packageType = detectOsPackageType(system);
  if (!packageType) return null;
  logger.debug(`Detected package type: ${packageType}`);
  return packageType;
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

export interface PackageInstallerOptions {
  packageType?: PackageType | null;
  exec?: ExecRunner;
  logger?: Logger;
}

export class PackageInstaller extends PackageInstallerABC {
  readonly packageType: PackageType | null;
  private readonly exec: ExecRunner;
  private readonly installers: Record<
    string,
    new (
      name: string,
      options: any,
    ) => PackageInstallerABC
  >;

  constructor(name: string, options: PackageInstallerOptions = {}) {
    const logger = options.logger ?? createLogger("info");
    super(name, { logger });
    this.packageType = options.packageType ?? detectPackageTypeFromOsRelease(logger);
    this.exec = options.exec ?? new BunExecRunner();
    this.installers = {
      deb: DebPackage,
      rpm: RpmPackage,
      AppImage: AppImage,
    };
  }

  async _queryPackageName(_source: string): Promise<string | null> {
    return null;
  }

  async _extractPackage(_source: string): Promise<string | null> {
    return null;
  }

  async install(source: string): Promise<string | null> {
    if (!this.packageType || this.packageType === "binary") {
      this.logger.error("Package installation is only supported for deb, rpm and AppImage");
      return null;
    }

    const wanted = this.packageType === "AppImage" ? ".appimage" : `.${this.packageType}`;
    const files = await walkFiles(source);
    const packagePath = files.find((file) => extname(file).toLowerCase() === wanted);
    if (!packagePath) {
      this.logger.error(`No ${wanted} file found in ${source}`);
      return null;
    }

    this.logger.debug(`Found package file: ${packagePath}`);
    try {
      const Installer = this.installers[this.packageType];
      if (!Installer) {
        this.logger.error(`Unsupported package type: ${this.packageType}`);
        return null;
      }
      const installer = new Installer(this.name, { logger: this.logger, exec: this.exec });
      this.logger.info(
        `Installing ${this.packageType} package; this might need sudo permissions...`,
      );
      const result = await installer.install(packagePath);
      if (result !== null) {
        this.name = installer.packageName;
      }
      return result;
    } catch (error) {
      this.logger.error(`Failed to install package: ${(error as Error).message}`);
      return null;
    }
  }

  async uninstall(): Promise<boolean> {
    if (!this.packageType || this.packageType === "binary") return false;
    try {
      const Installer = this.installers[this.packageType];
      if (!Installer) return false;
      const installer = new Installer(this.name, { logger: this.logger, exec: this.exec });
      return await installer.uninstall();
    } catch (error) {
      this.logger.error(`Failed to uninstall package: ${(error as Error).message}`);
      return false;
    }
  }
}
