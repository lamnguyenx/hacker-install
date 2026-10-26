import type { Dirent } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { BunExecRunner, type ExecRunner } from "../exec.ts";
import { chmod, ensureDir, removePath, unlinkIfExists } from "../fs-utils.ts";
import { systemName } from "../platform.ts";
import { PackageInstallerABC, type PackageInstallerOptions, parseIniValue } from "./base.ts";

export interface AppImageOptions extends PackageInstallerOptions {
  desktopEntryPath?: string;
  iconPath?: string;
  appimagePath?: string;
  exec?: ExecRunner;
}

async function walkDepth(
  root: string,
  maxDepth: number,
): Promise<Array<{ path: string; depth: number }>> {
  const results: Array<{ path: string; depth: number }> = [];
  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        results.push({ path: full, depth });
      }
    }
  }
  await walk(root, 0);
  return results;
}

export class AppImage extends PackageInstallerABC {
  private readonly desktopEntryPath: string;
  private readonly iconPath: string;
  private readonly appimagePath: string;
  private readonly exec: ExecRunner;

  constructor(name: string, options: AppImageOptions = {}) {
    super(name, options);
    const platform = systemName();
    const appsBase =
      platform === "linux" ? join(homedir(), ".local", "share", "applications") : homedir();
    const iconsBase =
      platform === "linux" ? join(homedir(), ".local", "share", "icons") : homedir();

    this.desktopEntryPath = options.desktopEntryPath ?? join(appsBase, `${name}.desktop`);
    this.iconPath = options.iconPath ?? join(iconsBase, `${name}.png`);
    this.appimagePath =
      options.appimagePath ?? join(homedir(), ".local", "share", "appimages", `${name}.appimage`);
    this.exec = options.exec ?? new BunExecRunner();
  }

  async _queryPackageName(_source: string): Promise<string | null> {
    return null;
  }

  async _extractPackage(source: string): Promise<string | null> {
    return this.validateSource(source, ".AppImage");
  }

  async install(source: string): Promise<string | null> {
    const sourcePath = await this._extractPackage(source);
    if (!sourcePath) return null;

    const destination = resolve(this.appimagePath);
    this.logger.debug(`Installing AppImage from: ${sourcePath}`);

    if (sourcePath !== destination) {
      await ensureDir(dirname(destination), 0o755);
      await copyFile(sourcePath, destination);
      this.logger.debug(`Copied AppImage to: ${destination}`);
    }

    await chmod(destination, 0o755);
    await this.desktopEntry();

    this.logger.debug(`AppImage installed to: ${this.appimagePath}`);
    return destination;
  }

  async uninstall(): Promise<boolean> {
    this.logger.debug(`Uninstalling AppImage: ${this.name}`);
    try {
      await this.desktopEntry(true);
      await unlinkIfExists(resolve(this.appimagePath));
      return true;
    } catch (error) {
      this.logger.error(`Failed to uninstall: ${(error as Error).message}`);
      return false;
    }
  }

  async desktopEntry(remove = false): Promise<void> {
    if (remove) {
      this.logger.debug(`Removing desktop entry and icon for: ${this.name}`);
      await unlinkIfExists(this.desktopEntryPath);
      await unlinkIfExists(this.iconPath);
      return;
    }

    this.logger.debug(`Creating desktop entry: ${this.desktopEntryPath}`);
    const appimageAbsPath = resolve(this.appimagePath);
    const extractedDir = await this.appimageExtract(appimageAbsPath);

    let needsNoSandbox = false;
    let pidName: string | null = null;

    if (extractedDir) {
      try {
        needsNoSandbox = await this.needsNoSandbox(extractedDir);
        pidName = await this.getPidName(extractedDir);
        this.logger.debug(`Detected PID name: ${pidName ?? "unknown"}`);

        const iconFile = await this.findIcon(extractedDir);
        if (iconFile) {
          this.logger.debug(`Found icon: ${iconFile}`);
          await ensureDir(dirname(this.iconPath), 0o755);
          await copyFile(iconFile, this.iconPath);
          this.logger.debug(`Icon copied to: ${this.iconPath}`);
        } else {
          this.logger.warn(`No icon found in extracted AppImage for: ${this.name}`);
        }
      } finally {
        await removePath(dirname(extractedDir));
      }
    } else {
      this.logger.warn(`Could not extract AppImage for inspection: ${appimageAbsPath}`);
    }

    const execCommand = needsNoSandbox ? `${this.appimagePath} --no-sandbox` : this.appimagePath;
    const startupWmClass = pidName ?? this.name;

    const content =
      "[Desktop Entry]\n" +
      `Name=${this.name}\n` +
      `Exec=${execCommand}\n` +
      `Icon=${this.iconPath}\n` +
      "Type=Application\n" +
      "Categories=Utility;\n" +
      `StartupWMClass=${startupWmClass}\n`;

    await ensureDir(dirname(this.desktopEntryPath), 0o755);
    await writeFile(this.desktopEntryPath, content, { encoding: "utf8", mode: 0o644 });
  }

  private async appimageExtract(appimagePath: string): Promise<string | null> {
    const tempDir = join(
      tmpdir(),
      `${this.name}_extract_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    );
    this.logger.debug(`Created temporary extraction directory: ${tempDir}`);

    try {
      await mkdir(tempDir, { recursive: true, mode: 0o700 });
      await chmod(appimagePath, 0o755);
      this.logger.debug(`Extracting AppImage: ${appimagePath}`);
      const result = await this.exec.runArgs([appimagePath, "--appimage-extract"], {
        cwd: tempDir,
      });
      if (result.code !== 0) {
        this.logger.error(`Failed to extract AppImage: ${result.stderrText.trim()}`);
        await removePath(tempDir);
        return null;
      }

      const squashfsRoot = join(tempDir, "squashfs-root");
      try {
        if (!(await stat(squashfsRoot)).isDirectory()) throw new Error("not a directory");
      } catch {
        this.logger.error("Extraction succeeded but squashfs-root not found.");
        await removePath(tempDir);
        return null;
      }
      return squashfsRoot;
    } catch (error) {
      this.logger.error(`Error extracting AppImage: ${(error as Error).message}`);
      await removePath(tempDir);
      return null;
    }
  }

  private async needsNoSandbox(extractedDir: string): Promise<boolean> {
    try {
      if ((await stat(join(extractedDir, "resources", "app.asar"))).isFile()) {
        this.logger.debug("Detected Electron app (app.asar), will use --no-sandbox");
        return true;
      }
    } catch {
      // not electron
    }

    for (const name of ["electron", "chrome-sandbox"]) {
      for (const parent of [extractedDir, join(extractedDir, "usr", "bin")]) {
        try {
          await stat(join(parent, name));
          this.logger.debug(`Detected Electron/Chromium (${name}), will use --no-sandbox`);
          return true;
        } catch {
          // continue
        }
      }
    }

    try {
      const entries = await readdir(join(extractedDir, "resources"), { withFileTypes: true });
      if (entries.some((entry) => extname(entry.name) === ".asar")) {
        this.logger.debug("Detected .asar in resources, will use --no-sandbox");
        return true;
      }
    } catch {
      // no resources dir
    }

    this.logger.debug("No Electron/sandbox indicators, Exec will not use --no-sandbox");
    return false;
  }

  private async getPidName(extractedDir: string): Promise<string | null> {
    try {
      const entries = await readdir(extractedDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".desktop")) continue;
        const text = await readFile(join(extractedDir, entry.name), "utf8");
        const execValue = parseIniValue(text, "Desktop Entry", "Exec");
        if (execValue) {
          const binary = execValue.split(/\s+/)[0];
          if (binary) {
            const pidName = basename(binary);
            this.logger.debug(`Found PID name '${pidName}' from ${entry.name}`);
            return pidName;
          }
        }
      }
    } catch {
      // no desktop files
    }
    this.logger.debug("No internal .desktop file found; could not detect PID name");
    return null;
  }

  private async findIcon(extractedDir: string): Promise<string | null> {
    try {
      if ((await stat(join(extractedDir, ".DirIcon"))).isFile()) {
        return join(extractedDir, ".DirIcon");
      }
    } catch {
      // continue
    }

    const iconExtensions = [".png", ".svg", ".xpm", ".jpg", ".jpeg"];
    const searchPaths = [
      join(extractedDir, "usr", "share", "icons"),
      join(extractedDir, "usr", "share", "pixmaps"),
      extractedDir,
    ];

    let anyIcon: string | null = null;
    for (const searchPath of searchPaths) {
      let exists = false;
      try {
        exists = (await stat(searchPath)).isDirectory();
      } catch {
        continue;
      }
      if (!exists) continue;

      const files = await walkDepth(searchPath, 3);
      for (const file of files) {
        const lower = file.path.toLowerCase();
        if (!iconExtensions.some((extension) => lower.endsWith(extension))) continue;
        if (!anyIcon) anyIcon = file.path;
        if (basename(lower).includes(this.name.toLowerCase())) {
          return file.path;
        }
      }
    }

    return anyIcon;
  }
}
