import type { AppContext } from "../../context.ts";
import { CliError } from "../../errors.ts";
import { extractUrl } from "../../extract.ts";
import { createTempDir, ensureDir, removePath } from "../../fs-utils.ts";
import { installBin } from "../../helper/install.ts";
import { type InstalledTool, nowIso, parseReleaseAsset } from "../../schemas.ts";
import { renderTable } from "../../ui/table.ts";
import { errorMessage, isValidToolName, truncate } from "../../utils.ts";
import {
  getAquaRegistryYaml,
  getBackend,
  getDescription,
  type MiseRegistryDeps,
  resolveDownloadUrl,
  searchRegistry,
} from "./registry.ts";
import type { AquaAsset, MiseToolInfo } from "./schemas.ts";

const GITHUB_API = "https://api.github.com";

async function getGithubVersions(
  deps: MiseRegistryDeps,
  owner: string,
  repo: string,
  token: string,
  options: { useTags?: boolean; preRelease?: boolean } = {},
): Promise<string[]> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `token ${token}`;
  const endpoint = options.useTags ? "tags" : "releases";
  try {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/${endpoint}`;
    const response = await deps.http.get(url, { headers, timeoutMs: 10_000 });
    if (!response.ok) {
      deps.logger.debug(
        `Failed to fetch GitHub ${endpoint} for ${owner}/${repo}: HTTP ${response.status}`,
      );
      return [];
    }
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) return [];
    if (options.useTags) {
      return data
        .filter(
          (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
        )
        .map((entry) => (typeof entry.name === "string" ? entry.name : ""))
        .filter(Boolean);
    }
    return data
      .filter(
        (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
      )
      .filter((entry) => !entry.draft && (options.preRelease || !entry.prerelease))
      .map((entry) => (typeof entry.tag_name === "string" ? entry.tag_name : ""))
      .filter(Boolean);
  } catch (error) {
    deps.logger.debug(
      `Failed to fetch GitHub ${endpoint} for ${owner}/${repo}: ${errorMessage(error)}`,
    );
    return [];
  }
}

export interface MiseGetOptions {
  version?: string;
  local?: boolean;
  prompt?: boolean;
  name?: string;
  hold?: boolean;
}

export class MiseInteractProvider {
  readonly toolname: string;
  private readonly ctx: AppContext;
  private backend: MiseToolInfo | null = null;
  private registry: Record<string, unknown> = {};

  constructor(toolname: string, ctx: AppContext) {
    this.toolname = toolname;
    this.ctx = ctx;
  }

  private deps(): MiseRegistryDeps {
    return {
      http: this.ctx.http,
      logger: this.ctx.logger,
      githubToken: this.ctx.config.tokens.github,
    };
  }

  async reportNotFound(): Promise<void> {
    this.ctx.logger.error(`No aqua backend found in mise registry for '${this.toolname}'`);
    let matches: string[];
    try {
      matches = await searchRegistry(this.deps(), this.toolname);
    } catch (error) {
      this.ctx.logger.debug(`Registry search failed: ${errorMessage(error)}`);
      return;
    }
    if (matches.length === 0) return;

    const rows: Array<Record<string, unknown>> = [];
    for (const name of matches) {
      rows.push({
        Name: `mise@${name}`,
        Description: truncate(await getDescription(this.deps(), name), 80),
      });
    }
    this.ctx.io.print(renderTable(rows, { title: "Did you mean" }));
  }

  private async ensureBackend(): Promise<boolean> {
    if (this.backend) return true;
    this.backend = await getBackend(this.deps(), this.toolname);
    if (!this.backend) return false;
    try {
      this.registry = await getAquaRegistryYaml(this.deps(), this.backend.aquaPath);
      const packages = Array.isArray(this.registry.packages) ? this.registry.packages : [];
      const first = packages[0];
      if (first && typeof first === "object" && first !== null) {
        const source = (first as Record<string, unknown>).version_source;
        if (typeof source === "string") this.backend.versionSource = source;
      }
    } catch {
      // best-effort: the registry can still resolve with defaults
    }
    return true;
  }

  async resolve(version = "", preRelease = false): Promise<string[]> {
    if (version) return [version];
    if (!(await this.ensureBackend())) {
      await this.reportNotFound();
      return [];
    }

    const backend = this.backend as MiseToolInfo;
    const useTags = backend.versionSource === "github_tag";
    const versions = await getGithubVersions(
      this.deps(),
      backend.owner,
      backend.repo,
      this.ctx.config.tokens.github,
      { useTags, preRelease },
    );
    if (versions.length === 0) {
      this.ctx.logger.warn(`No versions found for ${backend.owner}/${backend.repo}`);
    }
    return versions;
  }

  async select(candidates: string[]): Promise<AquaAsset | null> {
    if (candidates.length === 0) return null;
    if (!(await this.ensureBackend())) {
      await this.reportNotFound();
      return null;
    }

    const version = candidates[0] as string;
    const asset = await resolveDownloadUrl(this.deps(), this.toolname, version, {
      registry: this.registry,
    });
    if (!asset) {
      this.ctx.logger.error(`Could not resolve download URL for '${this.toolname}' ${version}`);
      return null;
    }

    return asset;
  }

  async prompt(toolname: string, candidate: AquaAsset): Promise<string> {
    const row: Record<string, unknown> = {
      Tool: toolname,
      Version: candidate.version,
      File: truncate(candidate.name, 40),
      URL: truncate(candidate.url, 40),
    };
    if (candidate.description) {
      row.Description = truncate(candidate.description, 80);
    }
    this.ctx.io.print(
      renderTable([row], {
        title: `Install ${toolname} (via mise/aqua)`,
        noWrap: false,
      }),
    );
    return (await this.ctx.io.prompt("Install selected tool? [Y/n]: ")).trim().toLowerCase() || "y";
  }

  async install(
    candidate: AquaAsset,
    toolname: string,
    tempDir: string,
    local = true,
  ): Promise<boolean> {
    this.ctx.logger.info(`Downloading ${candidate.url}`);
    try {
      await extractUrl(candidate.url, tempDir, {
        http: this.ctx.http,
        exec: this.ctx.exec,
        logger: this.ctx.logger,
      });
    } catch (error) {
      this.ctx.logger.error(`Download/extract failed: ${errorMessage(error)}`);
      return false;
    }

    await ensureDir(this.ctx.installPath, 0o700);
    const installed = await installBin(tempDir, this.ctx.installPath, {
      local,
      name: toolname,
      version: candidate.version,
      bundleRoot: this.ctx.bundlePath,
      exec: this.ctx.exec,
      logger: this.ctx.logger,
    });
    if (!installed) {
      this.ctx.logger.error(`Failed to install binary for '${toolname}'`);
      return false;
    }
    return true;
  }

  async get(options: MiseGetOptions = {}): Promise<void> {
    const toolname = options.name || this.toolname;
    if (!isValidToolName(toolname) || !isValidToolName(this.toolname)) {
      throw new CliError(`Invalid tool name: ${toolname}`);
    }

    const candidates = await this.resolve(options.version ?? "");
    if (candidates.length === 0) return;

    const asset = await this.select(candidates);
    if (!asset) return;

    if (options.prompt) {
      const decision = await this.prompt(toolname, asset);
      if (decision !== "y") return;
      this.ctx.io.print("\nDownloading...");
    }

    await ensureDir(this.ctx.bundlePath, 0o700);
    const tempDir = await createTempDir(this.ctx.bundlePath, `dn_${toolname}_`);
    try {
      if (!(await this.install(asset, toolname, tempDir, options.local ?? true))) return;
    } finally {
      await removePath(tempDir);
    }

    const now = nowIso();
    const releaseAsset = parseReleaseAsset({
      name: asset.name,
      browser_download_url: asset.url,
      content_type: "application/octet-stream",
      size: 0,
      download_count: 0,
      created_at: now,
      updated_at: now,
      id: 0,
      node_id: "",
      state: "uploaded",
    });

    const tool: InstalledTool = {
      name: toolname,
      provider: "mise",
      source: `mise@${this.toolname}`,
      tagName: asset.version,
      publishedAt: now,
      prerelease: false,
      description: asset.description || "Installed via mise/aqua registry",
      assets: [releaseAsset],
      holdUpdate: options.hold ?? false,
      packageType: "binary",
      installMethod: "binary",
    };

    this.ctx.state.set(tool);
    await this.ctx.state.save();
  }
}

export { getGithubVersions };
