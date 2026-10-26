import { architectureName, systemName } from "../../platform.ts";

const OS_MAP: Record<string, string> = {
  linux: "linux",
  darwin: "darwin",
  windows: "windows",
};

const ARCH_MAP: Record<string, string> = {
  x86_64: "amd64",
  amd64: "amd64",
  aarch64: "arm64",
  arm64: "arm64",
  armv7l: "arm",
  i386: "386",
  i686: "386",
};

export const MISE_REGISTRY_BASE =
  "https://raw.githubusercontent.com/jdx/mise/refs/heads/main/registry";
export const AQUA_REGISTRY_BASE =
  "https://raw.githubusercontent.com/aquaproj/aqua-registry/main/pkgs";
export const MISE_REGISTRY_TREE =
  "https://api.github.com/repos/jdx/mise/git/trees/main?recursive=1";
export const MISE_TIMEOUT_MS = 30_000;

export function currentOs(): string {
  const system = systemName();
  return OS_MAP[system] ?? system;
}

export function currentArch(): string {
  const arch = architectureName();
  return ARCH_MAP[arch] ?? arch;
}

export function trimV(version: string): string {
  return version.replace(/^v+/, "");
}
