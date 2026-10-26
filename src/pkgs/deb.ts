import { BunExecRunner, type ExecRunner } from "../exec.ts";
import { PackageInstallerABC, type PackageInstallerOptions } from "./base.ts";

export class DebPackage extends PackageInstallerABC {
  private readonly exec: ExecRunner;

  constructor(name: string, options: PackageInstallerOptions & { exec?: ExecRunner } = {}) {
    super(name, options);
    this.exec = options.exec ?? new BunExecRunner();
    this.packageName = name;
  }

  async _queryPackageName(source: string): Promise<string | null> {
    const result = await this.exec.runArgs(["dpkg-deb", "-f", source, "Package"]);
    if (result.code === 0 && result.stdoutText.trim()) {
      return result.stdoutText.trim();
    }
    return null;
  }

  async _extractPackage(source: string): Promise<string | null> {
    return this._extractPackageBase(source, ".deb", "DEB");
  }

  async install(source: string): Promise<string | null> {
    const sourcePath = await this._extractPackage(source);
    if (!sourcePath) return null;

    this.logger.debug(`Installing DEB package: ${sourcePath}`);
    let result = await this.exec.runArgs(["sudo", "dpkg", "-i", sourcePath], {
      interactive: true,
    });

    if (result.code !== 0) {
      this.logger.debug("Fixing dependencies with apt...");
      result = await this.exec.runArgs(["sudo", "apt-get", "install", "-f", "-y"], {
        interactive: true,
      });
      if (result.code !== 0) {
        this.logger.error(`Failed to install DEB package: ${result.stderrText.trim()}`);
        return null;
      }
    }

    this.logger.debug(`DEB package installed: ${this.packageName}`);
    return this.packageName;
  }

  async uninstall(): Promise<boolean> {
    this.logger.debug(`Uninstalling DEB package: ${this.packageName}`);
    let result = await this.exec.runArgs(["sudo", "apt", "remove", "-y", this.packageName], {
      interactive: true,
    });
    if (result.code !== 0) {
      this.logger.error(`Failed to uninstall: ${result.stderrText.trim()}`);
      result = await this.exec.runArgs(["sudo", "dpkg", "-r", this.packageName], {
        interactive: true,
      });
      if (result.code !== 0) {
        this.logger.error(`dpkg remove also failed: ${result.stderrText.trim()}`);
        return false;
      }
    }
    this.logger.debug(`DEB package uninstalled: ${this.packageName}`);
    return true;
  }
}
