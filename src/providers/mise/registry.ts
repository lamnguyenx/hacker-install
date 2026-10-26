import type { HttpClient } from "../../http.ts";
import type { Logger } from "../../logger.ts";
import { getCloseMatches } from "../../utils.ts";
import {
  AQUA_REGISTRY_BASE,
  currentArch,
  currentOs,
  MISE_REGISTRY_BASE,
  MISE_REGISTRY_TREE,
  MISE_TIMEOUT_MS,
  trimV,
} from "./config.ts";
import type { AquaAsset, MiseToolInfo } from "./schemas.ts";

export interface MiseRegistryDeps {
  http: HttpClient;
  logger: Logger;
  githubToken: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

const miseTomlCache = new Map<string, Record<string, unknown>>();

export function clearRegistryCache(): void {
  miseTomlCache.clear();
}

export async function getMiseToml(
  deps: MiseRegistryDeps,
  toolname: string,
): Promise<Record<string, unknown>> {
  const cached = miseTomlCache.get(toolname);
  if (cached) return cached;
  const url = `${MISE_REGISTRY_BASE}/${toolname}.toml`;
  const text = await deps.http.getText(url, { timeoutMs: MISE_TIMEOUT_MS });
  const parsed = Bun.TOML.parse(text) as unknown;
  const data = asRecord(parsed);
  miseTomlCache.set(toolname, data);
  return data;
}

export async function getAquaRegistryYaml(
  deps: MiseRegistryDeps,
  aquaPath: string,
): Promise<Record<string, unknown>> {
  const url = `${AQUA_REGISTRY_BASE}/${aquaPath}/registry.yaml`;
  const text = await deps.http.getText(url, { timeoutMs: MISE_TIMEOUT_MS });
  return asRecord(Bun.YAML.parse(text) as unknown);
}

export async function searchRegistry(deps: MiseRegistryDeps, query: string): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (deps.githubToken) headers.Authorization = `token ${deps.githubToken}`;
  const response = await deps.http.get(MISE_REGISTRY_TREE, {
    headers,
    timeoutMs: MISE_TIMEOUT_MS,
  });
  if (!response.ok) {
    throw new Error(`Failed to list mise registry: HTTP ${response.status}`);
  }
  const data = (await response.json()) as Record<string, unknown>;
  const tree = Array.isArray(data.tree) ? data.tree.filter(isRecord) : [];
  let names = tree
    .map((entry) => (typeof entry.path === "string" ? entry.path : ""))
    .filter((path) => path.startsWith("registry/") && path.endsWith(".toml"))
    .map((path) => path.slice("registry/".length, -".toml".length));

  const normalized = query.toLowerCase();
  names = names.filter((name) => name.toLowerCase() !== normalized);
  const substring = names.filter((name) => name.toLowerCase().includes(normalized));
  return (substring.length > 0 ? substring : getCloseMatches(normalized, names, 10, 0.7)).slice(
    0,
    10,
  );
}

export async function getDescription(deps: MiseRegistryDeps, toolname: string): Promise<string> {
  try {
    const data = await getMiseToml(deps, toolname);
    return typeof data.description === "string" ? data.description : "";
  } catch {
    return "";
  }
}

export async function getBackend(
  deps: MiseRegistryDeps,
  toolname: string,
): Promise<MiseToolInfo | null> {
  let data: Record<string, unknown>;
  try {
    data = await getMiseToml(deps, toolname);
  } catch {
    return null;
  }

  const description = typeof data.description === "string" ? data.description : "";
  const backends = Array.isArray(data.backends) ? data.backends : [];

  for (const backend of backends) {
    const backendString = isRecord(backend)
      ? typeof backend.full === "string"
        ? backend.full
        : ""
      : typeof backend === "string"
        ? backend
        : "";
    if (!backendString.startsWith("aqua:")) continue;
    const path = backendString.slice("aqua:".length);
    const parts = path.split("/");
    if (parts.length >= 2) {
      return {
        owner: parts[0] as string,
        repo: parts[1] as string,
        aquaPath: path,
        description,
        versionSource: "github_release",
      };
    }
  }
  return null;
}

function pickLatestOverride(pkg: Record<string, unknown>): Record<string, unknown> | null {
  const overrides = Array.isArray(pkg.version_overrides) ? pkg.version_overrides : [];
  for (const override of [...overrides].reverse()) {
    if (!isRecord(override)) continue;
    if (String(override.version_constraint ?? "").trim() === "true") return override;
  }
  return null;
}

function expandTemplate(
  template: string,
  version: string,
  osName: string,
  arch: string,
  fmt: string,
): string {
  return template
    .replaceAll("{{trimV .Version}}", trimV(version))
    .replaceAll("{{.Version}}", version)
    .replaceAll("{{.OS}}", osName)
    .replaceAll("{{.Arch}}", arch)
    .replaceAll("{{.Format}}", fmt);
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}

export async function resolveDownloadUrl(
  deps: MiseRegistryDeps,
  toolname: string,
  version: string,
  options: {
    osName?: string;
    arch?: string;
    registry?: Record<string, unknown>;
  } = {},
): Promise<AquaAsset | null> {
  const backend = await getBackend(deps, toolname);
  if (!backend) return null;

  const { owner, repo, description } = backend;
  let registry = options.registry;
  if (!registry) {
    try {
      registry = await getAquaRegistryYaml(deps, backend.aquaPath);
    } catch {
      return null;
    }
  }

  const packages = Array.isArray(registry.packages) ? registry.packages : [];
  if (packages.length === 0) return null;
  const pkg = asRecord(packages[0]);
  const osName = options.osName ?? currentOs();
  const arch = options.arch ?? currentArch();
  const packageType = typeof pkg.type === "string" ? pkg.type : "github_release";

  if (packageType !== "github_release" && packageType !== "http") {
    deps.logger.info(`Skipping unsupported aqua package type '${packageType}' for ${toolname}`);
    return null;
  }

  const override = pickLatestOverride(pkg);

  if (packageType === "http") {
    let urlTemplate = typeof pkg.url === "string" ? pkg.url : "";
    if (override && typeof override.url === "string") urlTemplate = override.url;
    if (!urlTemplate) return null;

    const fmt =
      (override && typeof override.format === "string"
        ? override.format
        : typeof pkg.format === "string"
          ? pkg.format
          : "zip") || "zip";
    const replacements = {
      ...stringMap(pkg.replacements),
      ...(override ? stringMap(override.replacements) : {}),
    };
    const resolvedOs = replacements[osName] ?? osName;
    const resolvedArch = replacements[arch] ?? arch;
    const downloadUrl = expandTemplate(urlTemplate, version, resolvedOs, resolvedArch, fmt);
    const filename = downloadUrl.split("/").pop() ?? "";
    return {
      url: downloadUrl,
      name: filename,
      version,
      fmt,
      owner,
      repo,
      description,
    };
  }

  let assetTemplate: string;
  let fmt: string;
  let replacements: Record<string, string>;

  if (override) {
    assetTemplate =
      typeof override.asset === "string"
        ? override.asset
        : typeof pkg.asset === "string"
          ? pkg.asset
          : "";
    fmt =
      typeof override.format === "string"
        ? override.format
        : typeof pkg.format === "string"
          ? pkg.format
          : "tar.gz";
    replacements = {
      ...stringMap(pkg.replacements),
      ...stringMap(override.replacements),
    };
    const overrides = Array.isArray(override.overrides) ? override.overrides : [];
    for (const osOverride of overrides) {
      if (!isRecord(osOverride)) continue;
      if (osOverride.goos === osName && typeof osOverride.format === "string") {
        fmt = osOverride.format;
      }
    }
  } else {
    assetTemplate = typeof pkg.asset === "string" ? pkg.asset : "";
    fmt = typeof pkg.format === "string" ? pkg.format : "tar.gz";
    replacements = stringMap(pkg.replacements);
  }

  if (!assetTemplate) return null;

  const resolvedOs = replacements[osName] ?? osName;
  const resolvedArch = replacements[arch] ?? arch;
  const filename = expandTemplate(assetTemplate, version, resolvedOs, resolvedArch, fmt);
  const downloadUrl = `https://github.com/${owner}/${repo}/releases/download/${version}/${filename}`;

  return {
    url: downloadUrl,
    name: filename,
    version,
    fmt,
    owner,
    repo,
    description,
  };
}
