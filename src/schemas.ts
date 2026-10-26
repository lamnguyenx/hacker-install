/** Data shapes stored in config.jsonc and state.json. */

export const CONFIG_VERSION = 1 as const;
export const STATE_VERSION = 1 as const;

export const PROVIDERS = [
  "github",
  "gitlab",
  "codeberg",
  "gitlab-self",
  "forgejo-self",
  "mise",
  "docker",
] as const;

export type ProviderId = (typeof PROVIDERS)[number];

export const PACKAGE_TYPES = ["binary", "deb", "rpm", "AppImage"] as const;
export type PackageType = (typeof PACKAGE_TYPES)[number];

export type InstallMethod = "binary" | "package";

export interface ReleaseAsset {
  browserDownloadUrl: string;
  contentType: string;
  createdAt: string;
  downloadCount: number;
  id: number;
  name: string;
  nodeId: string;
  size: number;
  state: string;
  updatedAt: string;
}

export interface RepositoryInfo {
  name: string;
  fullName: string;
  htmlUrl: string;
  description: string;
  language: string;
  stargazersCount: number;
}

export interface InstalledTool {
  name: string;
  provider: ProviderId;
  source: string;
  tagName: string;
  publishedAt: string;
  prerelease: boolean;
  description: string;
  assets: ReleaseAsset[];
  holdUpdate: boolean;
  customReleaseWords?: string[];
  packageType: PackageType;
  installMethod: InstallMethod;
  packageName?: string;
  dockerOpts?: string;
}

export interface ToolStateFile {
  version: typeof STATE_VERSION;
  tools: Record<string, InstalledTool>;
}

export interface ToolConfig {
  version: typeof CONFIG_VERSION;
  installPath: string;
  bundlePath: string;
  preRelease: boolean;
  tokens: {
    github: string;
    gitlab: Record<string, string>;
    forgejo: Record<string, string>;
  };
}

export function defaultConfig(): ToolConfig {
  return {
    version: CONFIG_VERSION,
    installPath: "~/bin",
    bundlePath: "~/Downloads2",
    preRelease: false,
    tokens: {
      github: "",
      gitlab: { "gitlab.com": "" },
      forgejo: { "codeberg.org": "" },
    },
  };
}

export function defaultToolState(): ToolStateFile {
  return { version: STATE_VERSION, tools: {} };
}

export function defaultAsset(): ReleaseAsset {
  return {
    browserDownloadUrl: "",
    contentType: "",
    createdAt: "",
    downloadCount: 0,
    id: 0,
    name: "",
    nodeId: "",
    size: 0,
    state: "",
    updatedAt: "",
  };
}

export function sizeMb(asset: ReleaseAsset): number {
  return Math.round((asset.size / 1_000_000) * 100) / 100;
}

export function isPackageTool(tool: InstalledTool): boolean {
  return tool.installMethod === "package";
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

export function normalizePackageType(
  value: unknown,
  fallback: PackageType = "binary",
): PackageType {
  if (typeof value !== "string") return fallback;
  const normalized = value.toLowerCase();
  if (normalized === "deb" || normalized === "rpm" || normalized === "binary") {
    return normalized;
  }
  if (normalized === "appimage") return "AppImage";
  return fallback;
}

export function normalizeInstallMethod(value: unknown): InstallMethod {
  return value === "package" ? "package" : "binary";
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function parsePublishedDate(value: string): Date {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Cannot parse date: ${value}`);
  }
  return new Date(timestamp);
}

// ── parsing ─────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringMap(value: unknown, defaults: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = { ...defaults };
  if (!isRecord(value)) return result;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}

export function parseReleaseAsset(value: unknown): ReleaseAsset {
  const raw = isRecord(value) ? value : {};
  return {
    browserDownloadUrl: asString(raw.browserDownloadUrl ?? raw.browser_download_url),
    contentType: asString(raw.contentType ?? raw.content_type),
    createdAt: asString(raw.createdAt ?? raw.created_at),
    downloadCount: asNumber(raw.downloadCount ?? raw.download_count),
    id: asNumber(raw.id),
    name: asString(raw.name),
    nodeId: asString(raw.nodeId ?? raw.node_id),
    size: asNumber(raw.size),
    state: asString(raw.state),
    updatedAt: asString(raw.updatedAt ?? raw.updated_at),
  };
}

export function parseInstalledTool(name: string, value: unknown): InstalledTool {
  const raw = isRecord(value) ? value : {};
  const provider = raw.provider;
  if (!isProviderId(provider)) {
    throw new Error(`Invalid provider for tool '${name}': ${String(provider)}`);
  }

  const packageType = normalizePackageType(raw.packageType ?? raw.package_type);
  const installMethod = normalizeInstallMethod(raw.installMethod ?? raw.install_method);

  const words = raw.customReleaseWords ?? raw.custom_release_words;
  const customReleaseWords = Array.isArray(words)
    ? words.filter((word): word is string => typeof word === "string")
    : undefined;

  const assets = Array.isArray(raw.assets) ? raw.assets.map(parseReleaseAsset) : [];

  return {
    name,
    provider,
    source: asString(raw.source ?? raw.url),
    tagName: asString(raw.tagName ?? raw.tag_name),
    publishedAt: asString(raw.publishedAt ?? raw.published_at),
    prerelease: asBoolean(raw.prerelease),
    description: asString(raw.description),
    assets,
    holdUpdate: asBoolean(raw.holdUpdate ?? raw.hold_update),
    ...(customReleaseWords ? { customReleaseWords } : {}),
    packageType,
    installMethod,
    ...(typeof (raw.packageName ?? raw.package_name) === "string"
      ? { packageName: asString(raw.packageName ?? raw.package_name) }
      : {}),
    ...(typeof (raw.dockerOpts ?? raw.docker_opts) === "string"
      ? { dockerOpts: asString(raw.dockerOpts ?? raw.docker_opts) }
      : {}),
  };
}

export function parseToolState(value: unknown): ToolStateFile {
  if (!isRecord(value)) {
    throw new Error("State file must contain a JSON object");
  }
  const looksLegacy =
    !("tools" in value) &&
    Object.keys(value).length > 0 &&
    Object.values(value).every((entry) => isRecord(entry));
  if (looksLegacy) {
    throw new Error(
      "Legacy Python state detected (flat '<source>#<name>' map). " +
        "Back it up and delete it, then reinstall your tools with 'hi get'.",
    );
  }
  const version = asNumber(value.version, STATE_VERSION);
  if (version > STATE_VERSION) {
    throw new Error(
      `State file version ${version} is newer than supported version ${STATE_VERSION}`,
    );
  }
  const rawTools = value.tools;
  const tools: Record<string, InstalledTool> = {};

  if (isRecord(rawTools)) {
    for (const [name, tool] of Object.entries(rawTools)) {
      tools[name] = parseInstalledTool(name, tool);
    }
  } else if (Array.isArray(rawTools)) {
    // Tolerate an array-shaped state file produced by hand or by an early build.
    for (const tool of rawTools) {
      if (!isRecord(tool)) continue;
      const name = asString(tool.name);
      if (name) tools[name] = parseInstalledTool(name, tool);
    }
  }

  return { version: STATE_VERSION, tools };
}

export function parseConfig(value: unknown): ToolConfig {
  if (!isRecord(value)) return defaultConfig();
  if (isRecord(value.config)) {
    throw new Error(
      "Legacy Python config detected (nested 'config' object). " +
        "Back it up and delete it, then re-run 'hi config' with the settings you want.",
    );
  }
  const version = asNumber(value.version, CONFIG_VERSION);
  if (version > CONFIG_VERSION) {
    throw new Error(
      `Config file version ${version} is newer than supported version ${CONFIG_VERSION}`,
    );
  }
  const tokens = isRecord(value.tokens) ? value.tokens : {};
  const defaults = defaultConfig();
  return {
    version: CONFIG_VERSION,
    installPath: asString(value.installPath, defaults.installPath),
    bundlePath: asString(value.bundlePath, defaults.bundlePath),
    preRelease: asBoolean(value.preRelease, defaults.preRelease),
    tokens: {
      github: asString(tokens.github),
      gitlab: asStringMap(tokens.gitlab, defaults.tokens.gitlab),
      forgejo: asStringMap(tokens.forgejo, defaults.tokens.forgejo),
    },
  };
}

export function parseRepositoryInfo(value: unknown): RepositoryInfo {
  const raw = isRecord(value) ? value : {};
  return {
    name: asString(raw.name),
    fullName: asString(raw.fullName ?? raw.full_name),
    htmlUrl: asString(raw.htmlUrl ?? raw.html_url),
    description: asString(raw.description),
    language: asString(raw.language),
    stargazersCount: asNumber(raw.stargazersCount ?? raw.stargazers_count),
  };
}
