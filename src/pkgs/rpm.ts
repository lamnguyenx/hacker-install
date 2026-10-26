import { BunExecRunner, type ExecRunner } from "../exec.ts";
import { PackageInstallerABC, type PackageInstallerOptions } from "./base.ts";

export class RpmPackage extends PackageInstallerABC {
  private readonly exec: ExecRunner;

  constructor(name: string, options: PackageInstallerOptions & { exec?: ExecRunner } = {}) {
    super(name, options);
    this.exec = options.exec ?? new BunExecRunner();
    this.packageName = name;
  }

  async _queryPackageName(source: string): Promise<string | null> {
    const result = await this.exec.runArgs(["rpm", "-qp", "--queryformat", "%{NAME}", source]);
    if (result.code === 0 && result.stdoutText.trim()) {
      return result.stdoutText.trim();
    }
    return null;
  }

  async _extractPackage(source: string): Promise<string | null> {
    return this._extractPackageBase(source, ".rpm", "RPM");
  }

  async install(source: string): Promise<string | null> {
    const sourcePath = await this._extractPackage(source);
    if (!sourcePath) return null;

    this.logger.debug(`Installing RPM package: ${sourcePath}`);
    let lastResult = await this.exec.runArgs(["sudo", "dnf", "install", "-y", sourcePath], {
      interactive: true,
    });
    if (lastResult.code !== 0) {
      lastResult = await this.exec.runArgs(["sudo", "yum", "install", "-y", sourcePath], {
        interactive: true,
      });
    }
    if (lastResult.code !== 0) {
      lastResult = await this.exec.runArgs(["sudo", "rpm", "-ivh", sourcePath], {
        interactive: true,
      });
    }
    if (lastResult.code !== 0) {
      this.logger.error(`Failed to install RPM package: ${lastResult.stderrText.trim()}`);
      return null;
    }

    this.logger.debug(`RPM package installed: ${this.packageName}`);
    return this.packageName;
  }

  async uninstall(): Promise<boolean> {
    this.logger.debug(`Uninstalling RPM package: ${this.packageName}`);
    let lastResult = await this.exec.runArgs(["sudo", "dnf", "remove", "-y", this.packageName], {
      interactive: true,
    });
    if (lastResult.code !== 0) {
      lastResult = await this.exec.runArgs(["sudo", "yum", "remove", "-y", this.packageName], {
        interactive: true,
      });
    }
    if (lastResult.code !== 0) {
      lastResult = await this.exec.runArgs(["sudo", "rpm", "-e", this.packageName], {
        interactive: true,
      });
    }
    if (lastResult.code !== 0) {
      this.logger.error(`Failed to uninstall: ${lastResult.stderrText.trim()}`);
      return false;
    }
    this.logger.debug(`RPM package uninstalled: ${this.packageName}`);
    return true;
  }
}
