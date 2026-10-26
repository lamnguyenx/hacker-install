import { readFileSync } from "node:fs";

export type SystemName = "linux" | "darwin" | "windows" | string;
export type PackageFamily = "deb" | "rpm" | null;

export const PACKAGE_ALIASES: Record<string, string[]> = {
  deb: ["debian", "ubuntu", "mint", "pop", "elementary", "kali"],
  rpm: ["fedora", "rhel", "centos", "rocky", "alma", "opensuse", "suse", "centos stream"],
  dmg: ["macos"],
  exe: ["windows"],
  msi: ["windows"],
  AppImage: ["linux"],
};

export interface PlatformInfo {
  system: SystemName;
  arch: string;
  isGlibc: boolean;
  packageFamily: PackageFamily;
  hasDesktopEnv: boolean;
}

export function systemName(value = process.platform): SystemName {
  if (value === "win32") return "windows";
  return value.toLowerCase();
}

export function architectureName(value = process.arch): string {
  switch (value) {
    case "x64":
      return "x86_64";
    case "arm64":
      return "aarch64";
    case "ia32":
      return "i386";
    case "arm":
      return "armv7l";
    default:
      return value.toLowerCase();
  }
}

function readOsRelease(): string {
  try {
    return readFileSync("/etc/os-release", "utf8").toLowerCase();
  } catch {
    return "";
  }
}

export function detectPackageFamily(system = systemName()): PackageFamily {
  if (system !== "linux") return null;
  const osRelease = readOsRelease();
  if (PACKAGE_ALIASES.rpm?.some((distro) => osRelease.includes(distro))) return "rpm";
  if (PACKAGE_ALIASES.deb?.some((distro) => osRelease.includes(distro))) return "deb";
  return null;
}

export function detectGlibc(): boolean {
  try {
    const result = Bun.spawnSync({
      cmd: ["ldd", "--version"],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const decoder = new TextDecoder();
    const output =
      `${decoder.decode(result.stdout)}\n${decoder.decode(result.stderr)}`.toLowerCase();
    return output.includes("glibc") || output.includes("gnu");
  } catch {
    return false;
  }
}

export function detectOsPackageType(system = systemName()): "deb" | "rpm" | "AppImage" | null {
  if (system !== "linux") return null;

  const osRelease = readOsRelease();
  if (PACKAGE_ALIASES.rpm?.some((distro) => osRelease.includes(distro))) return "rpm";
  if (PACKAGE_ALIASES.deb?.some((distro) => osRelease.includes(distro))) return "deb";

  if (Bun.which("rpm") || Bun.which("dnf") || Bun.which("yum")) return "rpm";
  if (Bun.which("dpkg") || Bun.which("apt")) return "deb";
  return "AppImage";
}

export function isAppImageOk(system = systemName()): boolean {
  return PACKAGE_ALIASES.AppImage?.includes(system) ?? false;
}

export function hasDesktopEnv(env: Record<string, string | undefined> = process.env): boolean {
  return env.XDG_SESSION_DESKTOP !== undefined;
}

export function detectPlatformInfo(
  env: Record<string, string | undefined> = process.env,
): PlatformInfo {
  const system = systemName();
  return {
    system,
    arch: architectureName(),
    isGlibc: detectGlibc(),
    packageFamily: detectPackageFamily(system),
    hasDesktopEnv: hasDesktopEnv(env),
  };
}

export function isSupportedPlatform(system = systemName()): boolean {
  return system === "linux" || system === "darwin";
}

export function requireSupportedPlatform(system = systemName()): void {
  if (!isSupportedPlatform(system)) {
    throw new Error(`Unsupported platform: ${system}. Supported: Linux, macOS, WSL.`);
  }
}
