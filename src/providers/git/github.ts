import type { HttpClient } from "../../http.ts";
import type { Logger } from "../../logger.ts";
import { parseReleaseAsset, parseRepositoryInfo, type RepositoryInfo } from "../../schemas.ts";
import { ApiError, RepoInfo } from "./base.ts";
import type { Release } from "./schemas.ts";

export interface GitHubInfoOptions {
  http: HttpClient;
  logger: Logger;
  token?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class GitHubInfo extends RepoInfo {
  private cachedTag: string | null = null;
  private cachedPreRelease: boolean | null = null;
  private cachedReleases: Release[] | null = null;

  constructor(repoUrl: string, options: GitHubInfoOptions) {
    super(options.http, options.logger, options.token ?? "");
    const validated = this.validateUrl(repoUrl, "github.com");
    const segments = new URL(validated).pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new ApiError(
        `Repository URL must be of the form https://github.com/<owner>/<repo>: ${repoUrl}`,
      );
    }
    this.owner = segments[0] as string;
    this.repoName = segments[1] as string;
    this.repoUrl = `https://github.com/${this.owner}/${this.repoName}`;
    this.api = `https://api.github.com/repos/${this.owner}/${this.repoName}`;
  }

  static async create(repoUrl: string, options: GitHubInfoOptions): Promise<GitHubInfo> {
    const instance = new GitHubInfo(repoUrl, options);
    await instance.loadInfo();
    return instance;
  }

  async loadInfo(): Promise<RepositoryInfo> {
    try {
      const data = await this._req(this.api);
      this.info = parseRepositoryInfo(data);
      return this.info;
    } catch (error) {
      this.logger.error(`Failed to fetch repository information: ${(error as Error).message}`);
      throw new ApiError(`Failed to fetch repository information: ${(error as Error).message}`);
    }
  }

  protected headers(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
    if (this.token) {
      headers.Authorization = `Basic ${Buffer.from(`user:${this.token}`).toString("base64")}`;
    } else {
      this.logger.debug("GitHub token not set");
    }
    return headers;
  }

  async _req(url: string): Promise<unknown> {
    return this.requestJson(url, this.headers());
  }

  async release(tagName = "", preRelease = false): Promise<Release[]> {
    if (
      this.cachedReleases !== null &&
      this.cachedTag === tagName &&
      this.cachedPreRelease === preRelease
    ) {
      return this.cachedReleases;
    }

    const api = tagName
      ? `${this.api}/releases/tags/${encodeURIComponent(tagName)}`
      : `${this.api}/releases${preRelease ? "" : "/latest"}`;
    this.logger.debug(`Fetching GitHub release from: ${api}`);
    this.cachedTag = tagName;
    this.cachedPreRelease = preRelease;
    this.cachedReleases = [];

    try {
      const data = await this._req(api);
      const entries = Array.isArray(data) ? data : isRecord(data) ? [data] : [];
      const releases: Release[] = [];

      for (const entry of entries) {
        if (!isRecord(entry)) continue;
        const assets = Array.isArray(entry.assets)
          ? entry.assets.filter(isRecord).map((asset) => parseReleaseAsset(asset))
          : [];
        releases.push({
          source: this.repoUrl,
          name: this.repoName,
          tagName: typeof entry.tag_name === "string" ? entry.tag_name : "",
          prerelease: Boolean(entry.prerelease),
          publishedAt: typeof entry.published_at === "string" ? entry.published_at : "",
          assets,
          description: this.info?.description ?? "",
        });
      }

      this.cachedReleases = releases;
      return releases;
    } catch (error) {
      this.logger.error(`Failed to fetch releases: ${(error as Error).message}`);
      return [];
    }
  }
}
