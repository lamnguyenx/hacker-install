import { PENALTY_EXTENSIONS, ReleaseScorer } from "../../helper/release-scorer.ts";
import type { HttpClient } from "../../http.ts";
import type { Logger } from "../../logger.ts";
import type { PlatformInfo } from "../../platform.ts";
import type { ReleaseAsset, RepositoryInfo } from "../../schemas.ts";
import type { Release } from "./schemas.ts";

export class RepositoryError extends Error {}
export class UnsupportedRepositoryError extends RepositoryError {}
export class ApiError extends RepositoryError {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export abstract class RepoInfo {
  repoUrl = "";
  repoName = "";
  owner = "";
  info: RepositoryInfo | null = null;
  api = "";
  token = "";
  protected readonly http: HttpClient;
  protected readonly logger: Logger;

  constructor(http: HttpClient, logger: Logger, token = "") {
    this.http = http;
    this.logger = logger;
    this.token = token;
  }

  protected validateUrl(repoUrl: string, domain: string): string {
    let url: URL;
    try {
      url = new URL(repoUrl);
    } catch {
      throw new UnsupportedRepositoryError(`Invalid repository URL: ${repoUrl}`);
    }
    if (url.hostname.toLowerCase() !== domain) {
      throw new UnsupportedRepositoryError(`Repository URL must contain '${domain}'`);
    }
    return `${url.protocol}//${url.hostname}${url.pathname.replace(/\/+$/, "")}`;
  }

  protected checkApiError(data: unknown, provider: string): void {
    if (isRecord(data) && typeof data.message === "string" && data.message) {
      throw new ApiError(`${provider} API error: ${data.message}`);
    }
  }

  protected handleRequestError(error: unknown): never {
    throw new ApiError(`Request failed: ${(error as Error).message}`);
  }

  protected async requestJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
    try {
      const response = await this.http.get(url, { headers });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ApiError(
          `Request failed: HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
        );
      }
      const data: unknown = await response.json();
      this.checkApiError(data, "Repository");
      return data;
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      this.handleRequestError(error);
    }
  }

  async repository(): Promise<unknown> {
    return this.requestJson(this.api);
  }

  abstract release(tagName?: string, preRelease?: boolean): Promise<Release[]>;
}

export interface GetReleaseOptions {
  repoUrl: string;
  extraWords?: string[];
  disableAdjustments?: boolean;
  packageType?: string | null;
  platform?: Partial<PlatformInfo>;
  logger: Logger;
}

export function getRelease(releases: Release[], options: GetReleaseOptions): ReleaseAsset | null {
  const extraWords = [...(options.extraWords ?? [])];
  if (options.packageType) extraWords.push(options.packageType);

  const scorer = new ReleaseScorer({
    extraWords,
    disableAdjustments: options.disableAdjustments,
    platform: options.platform,
    logger: options.logger,
  });
  options.logger.debug(`Scorer patterns: ${JSON.stringify(scorer.getInfo().allPatterns)}`);

  if (releases.length === 0) {
    options.logger.warn(`No releases found for: ${options.repoUrl}`);
    return null;
  }

  // A specific requested tag may itself be a pre-release. When it is the only
  // candidate, allow it; when a full release list is available, keep preferring
  // stable releases.
  const target =
    releases.find((release) => release.assets.length > 0 && !release.prerelease) ??
    (releases.length === 1 && releases[0]?.assets.length ? releases[0] : undefined);
  if (!target || target.assets.length === 0) {
    options.logger.warn("No suitable release found (non-prerelease with assets)");
    return null;
  }

  const candidates = target.assets.filter(
    (asset) =>
      ![...PENALTY_EXTENSIONS].some((extension) => asset.name.toLowerCase().endsWith(extension)),
  );
  if (candidates.length === 0) {
    options.logger.warn("No installable release assets found");
    return null;
  }

  const bestName = scorer.selectBest(candidates.map((asset) => asset.name));
  if (!bestName) {
    options.logger.warn(`No matching release found for ${options.repoUrl}`);
    return null;
  }

  return candidates.find((asset) => asset.name === bestName) ?? null;
}
