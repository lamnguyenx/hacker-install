import type { HttpClient } from "../../http.ts";
import type { Logger } from "../../logger.ts";
import { parseReleaseAsset, parseRepositoryInfo, type ReleaseAsset } from "../../schemas.ts";
import { splitPrefixedUrl } from "../base.ts";
import { ApiError, RepoInfo } from "./base.ts";
import type { Release } from "./schemas.ts";

export interface GitlabInfoOptions {
  http: HttpClient;
  logger: Logger;
  token?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class GitlabInfo extends RepoInfo {
  host = "gitlab.com";
  projectPath = "";
  private cachedTag: string | null = null;
  private cachedPreRelease: boolean | null = null;
  private cachedReleases: Release[] | null = null;

  constructor(repoUrl: string, options: GitlabInfoOptions) {
    super(options.http, options.logger, options.token ?? "");
    const validated = this.validateUrl(repoUrl, "gitlab.com");
    const segments = new URL(validated).pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new ApiError(
        `Repository URL must be of the form https://gitlab.com/<group>/<repo>: ${repoUrl}`,
      );
    }
    this.configure("gitlab.com", segments.join("/"), `https://gitlab.com/${segments.join("/")}`);
  }

  protected configure(host: string, projectPath: string, repoUrl: string): void {
    this.host = host;
    this.projectPath = projectPath;
    this.repoUrl = repoUrl.replace(/\/+$/, "");
    const segments = projectPath.split("/").filter(Boolean);
    this.owner = segments[0] ?? "";
    this.repoName = segments[segments.length - 1] ?? "";
    this.api = `https://${this.host}/api/v4/projects/${encodeURIComponent(projectPath)}`;
  }

  static async create(repoUrl: string, options: GitlabInfoOptions): Promise<GitlabInfo> {
    const instance = new GitlabInfo(repoUrl, options);
    await instance.loadInfo();
    return instance;
  }

  async loadInfo(): Promise<void> {
    try {
      const data = await this._req(this.api);
      if (!isRecord(data)) throw new Error("Unexpected response");
      this.info = parseRepositoryInfo({
        name: data.name,
        fullName: data.path_with_namespace,
        htmlUrl: data.web_url,
        description: data.description,
        language: data.predominant_language,
        stargazersCount: data.star_count,
      });
    } catch (error) {
      this.logger.error(
        `Failed to fetch GitLab repository information: ${(error as Error).message}`,
      );
      throw new ApiError(
        `Failed to fetch GitLab repository information: ${(error as Error).message}`,
      );
    }
  }

  protected headers(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers["PRIVATE-TOKEN"] = this.token;
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

    const releasesApi = `${this.api}/releases`;
    this.logger.debug(`Fetching GitLab releases from: ${releasesApi}`);
    this.cachedTag = tagName;
    this.cachedPreRelease = preRelease;
    this.cachedReleases = [];

    try {
      const data = await this._req(releasesApi);
      let entries = (Array.isArray(data) ? data : [data]).filter(isRecord);

      if (tagName) {
        entries = entries.filter((entry) => entry.tag_name === tagName);
      }
      if (!preRelease) {
        entries = entries.filter((entry) => !entry.upcoming_release);
      }
      if (!tagName && entries.length > 0) {
        entries = [
          entries.reduce((best, entry) => {
            const bestDate = Date.parse(String(best.created_at ?? ""));
            const entryDate = Date.parse(String(entry.created_at ?? ""));
            return entryDate > bestDate ? entry : best;
          }),
        ];
      }

      const releases: Release[] = [];
      for (const entry of entries) {
        const createdAt = typeof entry.created_at === "string" ? entry.created_at : "";
        const assetsRaw = isRecord(entry.assets) ? entry.assets : {};
        const links = Array.isArray(assetsRaw.links) ? assetsRaw.links.filter(isRecord) : [];
        const assets: ReleaseAsset[] = links.map((link) => {
          const name = typeof link.name === "string" ? link.name : "";
          const tag = typeof entry.tag_name === "string" ? entry.tag_name : "";
          let directUrl = typeof link.direct_asset_url === "string" ? link.direct_asset_url : "";
          if (!directUrl && tag && name) {
            directUrl = `https://${this.host}/${this.projectPath}/-/releases/${tag}/downloads/${name}`;
          }
          return parseReleaseAsset({
            ...link,
            browser_download_url: directUrl || link.url,
            content_type: link.link_type,
            created_at: createdAt,
            updated_at: createdAt,
            download_count: link.count,
            state: "uploaded",
          });
        });

        releases.push({
          source: this.repoUrl,
          name: this.repoName,
          tagName: typeof entry.tag_name === "string" ? entry.tag_name : "",
          prerelease: Boolean(entry.upcoming_release),
          publishedAt: createdAt,
          assets,
          description: this.info?.description ?? "",
        });
      }

      this.cachedReleases = releases;
      return releases;
    } catch (error) {
      this.logger.error(`Failed to fetch GitLab releases: ${(error as Error).message}`);
      return [];
    }
  }
}

export class SelfHostedGitlabInfo extends GitlabInfo {
  constructor(repoUrl: string, options: GitlabInfoOptions) {
    super("https://gitlab.com/placeholder/repo", options);
    const { host, path } = splitPrefixedUrl(repoUrl, "gitlab@");
    this.configure(host, path, repoUrl);
  }

  static override async create(
    repoUrl: string,
    options: GitlabInfoOptions,
  ): Promise<SelfHostedGitlabInfo> {
    const instance = new SelfHostedGitlabInfo(repoUrl, options);
    await instance.loadInfo();
    return instance;
  }
}
