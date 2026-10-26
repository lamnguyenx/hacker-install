import { parseReleaseAsset, parseRepositoryInfo, type RepositoryInfo } from "../../schemas.ts";
import { splitPrefixedUrl } from "../base.ts";
import { ApiError, UnsupportedRepositoryError } from "./base.ts";
import { GitHubInfo, type GitHubInfoOptions } from "./github.ts";
import type { Release } from "./schemas.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ForgejoInfoOptions extends GitHubInfoOptions {}

export class ForgejoInfo extends GitHubInfo {
  private forgejoCachedTag: string | null = null;
  private forgejoCachedPreRelease: boolean | null = null;
  private forgejoCachedReleases: Release[] | null = null;

  constructor(repoUrl: string, options: ForgejoInfoOptions) {
    super("https://github.com/placeholder/repo", options);
    const resolved = this.resolve(repoUrl);
    this.repoUrl = repoUrl.replace(/\/+$/, "");
    this.owner = resolved.owner;
    this.repoName = resolved.repo;
    this.api = `${resolved.host}/api/v1/repos/${resolved.owner}/${resolved.repo}`;
  }

  protected resolve(repoUrl: string): { host: string; owner: string; repo: string } {
    let url: URL;
    try {
      url = new URL(repoUrl);
    } catch {
      throw new UnsupportedRepositoryError(`Invalid Forgejo/Codeberg repository URL: ${repoUrl}`);
    }
    if (!url.protocol || !url.hostname) {
      throw new UnsupportedRepositoryError(`Invalid Forgejo/Codeberg repository URL: ${repoUrl}`);
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new UnsupportedRepositoryError(
        `Repository URL must be of the form https://<host>/<owner>/<repo>: ${repoUrl}`,
      );
    }
    return {
      host: `${url.protocol}//${url.host}`,
      owner: segments[segments.length - 2] as string,
      repo: segments[segments.length - 1] as string,
    };
  }

  static override async create(repoUrl: string, options: ForgejoInfoOptions): Promise<ForgejoInfo> {
    const instance = new ForgejoInfo(repoUrl, options);
    await instance.loadInfo();
    return instance;
  }

  protected override headers(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) {
      headers.Authorization = `token ${this.token}`;
    } else {
      this.logger.debug("Forgejo/Codeberg token not set");
    }
    return headers;
  }

  override async _req(url: string): Promise<unknown> {
    return this.requestJson(url, this.headers());
  }

  override async loadInfo(): Promise<RepositoryInfo> {
    try {
      const raw = await this._req(this.api);
      if (!isRecord(raw)) throw new Error("Unexpected response");
      this.info = parseRepositoryInfo({
        ...raw,
        stargazersCount: raw.stars_count,
      });
      return this.info;
    } catch (error) {
      this.logger.error(`Failed to fetch repository information: ${(error as Error).message}`);
      throw new ApiError(`Failed to fetch repository information: ${(error as Error).message}`);
    }
  }

  override async release(tagName = "", preRelease = false): Promise<Release[]> {
    if (
      this.forgejoCachedReleases !== null &&
      this.forgejoCachedTag === tagName &&
      this.forgejoCachedPreRelease === preRelease
    ) {
      return this.forgejoCachedReleases;
    }

    const api = tagName
      ? `${this.api}/releases/tags/${encodeURIComponent(tagName)}`
      : `${this.api}/releases`;
    this.logger.debug(`Fetching Forgejo releases from: ${api}`);
    this.forgejoCachedTag = tagName;
    this.forgejoCachedPreRelease = preRelease;
    this.forgejoCachedReleases = [];

    try {
      const data = await this._req(api);
      let entries = (Array.isArray(data) ? data : [data]).filter(isRecord);
      if (!tagName) {
        entries = entries.filter((entry) => !entry.draft && (preRelease || !entry.prerelease));
        entries.sort((a, b) => {
          const aDate = Date.parse(String(a.published_at ?? a.created_at ?? ""));
          const bDate = Date.parse(String(b.published_at ?? b.created_at ?? ""));
          return bDate - aDate;
        });
        entries = entries.slice(0, 1);
      }

      const releases: Release[] = [];
      for (const entry of entries) {
        const assets = Array.isArray(entry.assets)
          ? entry.assets.filter(isRecord).map((asset) => parseReleaseAsset(asset))
          : [];
        releases.push({
          source: this.repoUrl,
          name: this.repoName,
          tagName: typeof entry.tag_name === "string" ? entry.tag_name : "",
          prerelease: Boolean(entry.prerelease),
          publishedAt:
            typeof entry.published_at === "string"
              ? entry.published_at
              : typeof entry.created_at === "string"
                ? entry.created_at
                : "",
          assets,
          description: this.info?.description ?? "",
        });
      }

      this.forgejoCachedReleases = releases;
      return releases;
    } catch (error) {
      this.logger.error(`Failed to fetch Forgejo releases: ${(error as Error).message}`);
      return [];
    }
  }
}

export class SelfHostedForgejoInfo extends ForgejoInfo {
  constructor(repoUrl: string, options: ForgejoInfoOptions) {
    super("https://codeberg.org/placeholder/repo", options);
    const { host, path } = splitPrefixedUrl(repoUrl, "forgejo@");
    const segments = path.split("/").filter(Boolean);
    const owner = segments[segments.length - 2] as string;
    const repo = segments[segments.length - 1] as string;
    this.repoUrl = repoUrl.replace(/\/+$/, "");
    this.owner = owner;
    this.repoName = repo;
    this.api = `https://${host}/api/v1/repos/${owner}/${repo}`;
  }

  static override async create(
    repoUrl: string,
    options: ForgejoInfoOptions,
  ): Promise<SelfHostedForgejoInfo> {
    const instance = new SelfHostedForgejoInfo(repoUrl, options);
    await instance.loadInfo();
    return instance;
  }
}
