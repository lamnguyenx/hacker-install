import { join } from "node:path";
import pc from "picocolors";
import type { AppContext } from "../../context.ts";
import { download } from "../../download.ts";
import { CliError } from "../../errors.ts";
import { extractUrl } from "../../extract.ts";
import { createTempDir, ensureDir, pathExists, removePath } from "../../fs-utils.ts";
import { installBin } from "../../helper/install.ts";
import { PENALTY_EXTENSIONS } from "../../helper/release-scorer.ts";
import { detectPackageTypeFromAssetName, PackageInstaller } from "../../pkgs/main.ts";
import { isAppImageOk } from "../../platform.ts";
import {
  type InstalledTool,
  type PackageType,
  type ProviderId,
  parseReleaseAsset,
  type ReleaseAsset,
  sizeMb,
} from "../../schemas.ts";
import { DIM_TABLE_THEME, renderTable } from "../../ui/table.ts";
import { isNone, isValidToolName, toWords } from "../../utils.ts";
import {
  normalizeRepositorySource,
  repoNameFromSource,
  resolveProvider,
  splitPrefixedUrl,
} from "../base.ts";
import { ApiError, getRelease, type RepoInfo, UnsupportedRepositoryError } from "./base.ts";
import { ForgejoInfo, SelfHostedForgejoInfo } from "./forgejo.ts";
import { GitHubInfo } from "./github.ts";
import { GitlabInfo, SelfHostedGitlabInfo } from "./gitlab.ts";
import type { Release } from "./schemas.ts";

export async function hostToken(
  ctx: AppContext,
  tokens: Record<string, string>,
  host: string,
): Promise<string> {
  if (!(host in tokens)) {
    tokens[host] = "";
    await ctx.saveConfig();
    ctx.logger.info(`Registered new host '${host}', set a token with: hi config --host ${host}`);
  }
  return tokens[host] ?? "";
}

function providerClassError(error: unknown): never {
  if (error instanceof UnsupportedRepositoryError || error instanceof ApiError) {
    throw new CliError((error as Error).message);
  }
  throw new CliError(`Unexpected error: ${(error as Error).message}`);
}

export async function getRepoInfo(ctx: AppContext, source: string): Promise<RepoInfo> {
  const provider = resolveProvider(source);
  if (!provider) {
    throw new CliError(
      "Unsupported repository URL. Supported: GitHub, GitLab, Codeberg, " +
        "gitlab@<host>/<owner>/<repo>, forgejo@<host>/<owner>/<repo>.",
    );
  }

  try {
    const normalized = normalizeRepositorySource(source);
    const options = {
      http: ctx.http,
      logger: ctx.logger,
      token: "",
    };

    switch (provider) {
      case "github":
        return await GitHubInfo.create(normalized, options);
      case "gitlab":
        options.token = await hostToken(ctx, ctx.config.tokens.gitlab, "gitlab.com");
        return await GitlabInfo.create(normalized, options);
      case "codeberg":
        options.token = await hostToken(ctx, ctx.config.tokens.forgejo, "codeberg.org");
        return await ForgejoInfo.create(normalized, options);
      case "gitlab-self": {
        const { host } = splitPrefixedUrl(normalized, "gitlab@");
        options.token = await hostToken(ctx, ctx.config.tokens.gitlab, host);
        return await SelfHostedGitlabInfo.create(normalized, options);
      }
      case "forgejo-self": {
        const { host } = splitPrefixedUrl(normalized, "forgejo@");
        options.token = await hostToken(ctx, ctx.config.tokens.forgejo, host);
        return await SelfHostedForgejoInfo.create(normalized, options);
      }
      default:
        throw new UnsupportedRepositoryError("Unsupported repository provider");
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    providerClassError(error);
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

export function extractWordsFromFilename(filename: string): string[] {
  const dot = filename.lastIndexOf(".");
  const basename = dot > 0 ? filename.slice(0, dot) : filename;
  return toWords(basename.replaceAll(".", "-"), ["v", "unknown"]);
}

function availablePackageType(ctx: AppContext, releases: Release[]): PackageType | null {
  if (!ctx.osPackageType) return null;
  for (const release of releases) {
    const types = new Set(
      release.assets
        .map((asset) => detectPackageTypeFromAssetName(asset.name))
        .filter((value): value is PackageType => value !== null),
    );
    if (types.has(ctx.osPackageType)) return ctx.osPackageType;
    if (isAppImageOk(ctx.platform.system) && types.has("AppImage")) return "AppImage";
  }
  return null;
}

function showPkgHint(
  ctx: AppContext,
  releases: Release[],
  packageMode: boolean,
  source: string,
): void {
  if (packageMode || !ctx.osPackageType) return;
  const pkg = availablePackageType(ctx, releases);
  if (pkg) {
    ctx.io.print(
      `\n${pc.bold(
        pc.yellow(
          `>> A ${pkg} package is available for this release. ` +
            `Use hi get ${source} --pkg to install it.`,
        ),
      )}`,
    );
  }
}

export function selectableAssets(release: Release): Map<number, ReleaseAsset> {
  const assets = release.assets.filter(
    (asset) =>
      ![...PENALTY_EXTENSIONS].some((extension) => asset.name.toLowerCase().endsWith(extension)),
  );
  return new Map(assets.map((asset, index): [number, ReleaseAsset] => [index + 1, asset]));
}

function showReleaseAssets(
  ctx: AppContext,
  release: Release,
  toolname: string,
): Map<number, ReleaseAsset> {
  const choices = selectableAssets(release);
  if (choices.size === 0) {
    ctx.io.print(pc.red("No assets available for this release"));
    return choices;
  }
  ctx.io.print(
    renderTable(
      [...choices.entries()].map(([id, asset]) => ({
        "Asset ID": id,
        Filename: asset.name,
        "Size (MB)": sizeMb(asset),
        Downloads: asset.downloadCount,
      })),
      {
        title: `📦 Available Assets for ${toolname}`,
        theme: DIM_TABLE_THEME,
      },
    ),
  );
  return choices;
}

function selectAssetById(
  ctx: AppContext,
  release: Release,
  selection: string,
): ReleaseAsset | null {
  const choices = selectableAssets(release);
  const id = Number.parseInt(selection, 10);
  if (!Number.isFinite(id)) {
    ctx.io.print(pc.red("Invalid input. Please enter a number or 'n' to cancel"));
    return null;
  }
  const asset = choices.get(id);
  if (!asset) {
    ctx.io.print(pc.red(`Invalid ID. Please select between 1 and ${choices.size}`));
    return null;
  }
  return asset;
}

export interface GitGetOptions {
  version?: string;
  assetFile?: string;
  local?: boolean;
  prompt?: boolean;
  name?: string;
  hold?: boolean;
  force?: boolean;
  dockerOpts?: string | null;
}

export interface SelectHints {
  extraWords?: string[];
  disableAdjustments?: boolean;
  knownNames?: Set<string>;
}

export class GitInteractProvider {
  private readonly repo: RepoInfo;
  private readonly ctx: AppContext;
  packageMode: boolean;
  packageType: PackageType | null;
  private releases: Release[] = [];
  private selectedRelease: Release | null = null;

  constructor(repo: RepoInfo, ctx: AppContext, packageMode = false) {
    this.repo = repo;
    this.ctx = ctx;
    this.packageMode = packageMode;
    this.packageType = ctx.osPackageType;
  }

  async resolve(version = "", preRelease = false): Promise<Release[]> {
    const usePreRelease = preRelease || this.ctx.config.preRelease;
    this.releases = await this.repo.release(version, usePreRelease);
    return this.releases;
  }

  private filterAssetsForPkgMode(candidates: Release[]): void {
    for (const release of candidates) {
      const native = release.assets.filter(
        (asset) => detectPackageTypeFromAssetName(asset.name) === this.packageType,
      );
      if (native.length > 0) {
        release.assets = native;
        continue;
      }
      if (isAppImageOk(this.ctx.platform.system)) {
        const fallback = release.assets.filter(
          (asset) => detectPackageTypeFromAssetName(asset.name) === "AppImage",
        );
        if (fallback.length > 0) {
          release.assets = fallback;
          if (this.packageType !== "AppImage") {
            this.ctx.logger.info(`No ${this.packageType} package found, falling back to AppImage`);
            this.packageType = "AppImage";
          }
          continue;
        }
      }
      release.assets = [];
    }
  }

  async select(candidates: Release[], hints: SelectHints = {}): Promise<ReleaseAsset | null> {
    const extraWords = hints.extraWords;
    const disableAdjustments = hints.disableAdjustments ?? false;
    const knownNames = hints.knownNames ?? new Set<string>();

    if (this.packageMode) {
      if (!this.packageType) {
        this.ctx.logger.error(packageUnsupportedMessage(this.ctx));
        return null;
      }
      this.filterAssetsForPkgMode(candidates);
    }

    if (candidates.length === 0) return null;
    this.selectedRelease = candidates[0] ?? null;
    if (!this.selectedRelease) return null;

    for (const release of candidates) {
      for (const asset of release.assets) {
        if (knownNames.has(asset.name)) {
          this.ctx.logger.debug(`Exact asset match: '${asset.name}'`);
          this.selectedRelease = release;
          return asset;
        }
      }
    }

    const fallbackPkg = this.packageMode ? null : availablePackageType(this.ctx, candidates);
    const result = getRelease(candidates, {
      repoUrl: this.repo.repoUrl,
      extraWords,
      disableAdjustments,
      packageType: this.packageMode ? this.packageType : null,
      platform: this.ctx.platform,
      logger: this.ctx.logger,
    });

    if (result) {
      const owner = candidates.find((release) =>
        release.assets.some((asset) => asset.name === result.name),
      );
      if (owner) this.selectedRelease = owner;
      return result;
    }

    if (fallbackPkg) {
      this.ctx.logger.info(`No standalone asset matched; switching to --pkg mode (${fallbackPkg})`);
      this.packageMode = true;
      this.packageType = fallbackPkg;
      return this.select(candidates, hints);
    }

    this.ctx.logger.error("No suitable release assets found");
    const repoName = repoNameFromSource(this.repo.repoUrl);
    this.ctx.io.print(
      pc.bold(
        pc.cyan(
          `\nYou can retry installing via mise provider: ` +
            `\n${pc.green(`hi get mise@${repoName}`)}\n`,
        ),
      ),
    );
    return null;
  }

  async prompt(toolname: string, candidate: ReleaseAsset): Promise<string> {
    const release = this.selectedRelease;
    if (!release || !this.repo.info) return "y";
    const info = this.repo.info;
    const label = (text: string) => pc.underline(pc.bold(text));
    this.ctx.io.print(
      `\n${label("📑 Repo")}     : ${info.fullName}` +
        `\n${label("🌟 Stars")}    : ${pc.blue(String(info.stargazersCount))}` +
        `\n${label("🔮 Language")} : ${pc.magenta(info.language || "N/A")}` +
        `\n${label("🔥 Title")}    : ${pc.italic(pc.yellow(info.description || "N/A"))}`,
    );

    showReleaseAssets(this.ctx, release, toolname);
    this.ctx.io.print(
      renderTable(
        [
          {
            Name: toolname,
            "Selected Item": candidate.name,
            Version: release.tagName,
            "Size Mb": sizeMb(candidate),
            Downloads: candidate.downloadCount,
          },
        ],
        { title: `🚀 Install: ${toolname}` },
      ),
    );
    this.ctx.io.print(`\nPath: ${this.ctx.installPath}`);
    return (
      (await this.ctx.io.prompt("Install selected tool? [Y/n/ Asset ID]: ")).trim().toLowerCase() ||
      "y"
    );
  }

  async install(
    candidate: ReleaseAsset,
    toolname: string,
    tempDir: string,
    local = true,
  ): Promise<boolean> {
    const release = this.selectedRelease;
    if (!release) return false;

    const assetPackage = detectPackageTypeFromAssetName(candidate.name);
    const effectivePackage = assetPackage ?? (this.packageMode ? this.packageType : null);

    if (effectivePackage) {
      if (this.packageMode && this.packageType && effectivePackage !== this.packageType) {
        this.ctx.logger.info(
          `Selected asset '${candidate.name}' is ${effectivePackage}; ` +
            `overriding requested ${this.packageType} package type`,
        );
      }
      await download(candidate.browserDownloadUrl, tempDir, {
        http: this.ctx.http,
        exec: this.ctx.exec,
        logger: this.ctx.logger,
      });
      const installer = new PackageInstaller(effectivePackage, {
        packageType: effectivePackage,
        exec: this.ctx.exec,
        logger: this.ctx.logger,
      });
      const result = await installer.install(tempDir);
      if (result === null) {
        this.ctx.logger.error(`Failed to install ${toolname} as ${effectivePackage} package`);
        return false;
      }
      release.assets = [candidate];
      release.packageType = effectivePackage;
      release.installMethod = "package";
      release.packageName = installer.name;
      return true;
    }

    await extractUrl(candidate.browserDownloadUrl, tempDir, {
      http: this.ctx.http,
      exec: this.ctx.exec,
      logger: this.ctx.logger,
    });
    release.assets = [candidate];
    await ensureDir(this.ctx.installPath, 0o700);
    return installBin(tempDir, this.ctx.installPath, {
      local,
      name: toolname,
      version: release.tagName,
      bundleRoot: this.ctx.bundlePath,
      exec: this.ctx.exec,
      logger: this.ctx.logger,
    });
  }

  private async isCurrentInstall(
    toolname: string,
    asset: ReleaseAsset,
    installed: InstalledTool | undefined,
  ): Promise<boolean> {
    if (!installed) return false;
    if (installed.source !== this.repo.repoUrl) return false;
    if (!this.selectedRelease || installed.tagName !== this.selectedRelease.tagName) return false;
    if (installed.assets[0]?.name !== asset.name) return false;

    const packageType =
      detectPackageTypeFromAssetName(asset.name) ?? (this.packageMode ? this.packageType : null);
    const installedAsPackage =
      installed.installMethod === "package" || installed.packageType !== "binary";
    if ((packageType !== null) !== installedAsPackage) return false;

    // Package installs live outside the install path. Binary and bundle
    // installs go through a link in the install path, so use that to detect a
    // tool that was removed by hand and must be reinstalled.
    return installedAsPackage || pathExists(join(this.ctx.installPath, toolname));
  }

  async get(options: GitGetOptions = {}): Promise<void> {
    const assetFile = options.assetFile ?? "";
    const customWords = !isNone(assetFile) ? extractWordsFromFilename(assetFile) : undefined;

    const releases = await this.resolve(options.version ?? "");
    if (releases.length === 0) {
      this.ctx.logger.error(`No releases found: ${this.repo.repoUrl}`);
      return;
    }
    if (this.packageMode && !this.packageType) {
      this.ctx.logger.error(packageUnsupportedMessage(this.ctx));
      return;
    }

    const toolname = isNone(options.name)
      ? this.repo.repoName.toLowerCase()
      : (options.name as string).toLowerCase();
    if (!isValidToolName(toolname)) {
      throw new CliError(`Invalid tool name: ${toolname}`);
    }
    const cached = this.ctx.state.get(toolname);
    const sameSource = cached?.source === this.repo.repoUrl;
    const cachedWords = sameSource ? cached?.customReleaseWords : undefined;
    const extraWords = customWords ?? cachedWords;
    const disableAdjustments = extraWords !== undefined;

    const knownNames = new Set<string>();
    if (!isNone(assetFile)) knownNames.add(assetFile);
    if (sameSource && cached?.assets[0]) knownNames.add(cached.assets[0].name);

    showPkgHint(this.ctx, releases, this.packageMode, this.repo.repoUrl);

    let asset = await this.select(releases, {
      extraWords,
      disableAdjustments,
      knownNames,
    });
    if (!asset) return;

    if (!options.force && !options.hold && (await this.isCurrentInstall(toolname, asset, cached))) {
      this.ctx.logger.info(
        `${toolname} ${cached?.tagName ?? ""} is already installed (use --force to reinstall)`,
      );
      return;
    }

    let resolvedWords = customWords ?? cachedWords;
    if (options.prompt) {
      const decision = await this.prompt(toolname, asset);
      if (decision === "n") return;
      if (decision !== "y") {
        if (!this.selectedRelease) return;
        const selected = selectAssetById(this.ctx, this.selectedRelease, decision);
        if (!selected) return;
        asset = selected;
        resolvedWords = extractWordsFromFilename(asset.name);
      }
      this.ctx.io.print(pc.magenta("\nDownloading..."));
    }

    await ensureDir(this.ctx.bundlePath, 0o700);
    const tempDir = await createTempDir(this.ctx.bundlePath, `dn_${this.repo.repoName}_`);
    try {
      if (!(await this.install(asset, toolname, tempDir, options.local ?? true))) {
        return;
      }
    } finally {
      await removePath(tempDir);
    }

    const release = this.selectedRelease;
    if (!release) return;

    const provider = resolveProvider(this.repo.repoUrl);
    if (!provider) {
      throw new CliError(`Unsupported provider for ${this.repo.repoUrl}`);
    }

    const tool: InstalledTool = {
      name: toolname,
      provider: provider as ProviderId,
      source: this.repo.repoUrl,
      tagName: release.tagName,
      publishedAt: release.publishedAt,
      prerelease: release.prerelease,
      description: this.repo.info?.description || release.description,
      assets: release.assets,
      holdUpdate: options.hold ?? false,
      packageType: release.packageType ?? "binary",
      installMethod: release.installMethod ?? "binary",
      ...(release.packageName ? { packageName: release.packageName } : {}),
      ...(resolvedWords && resolvedWords.length > 0 ? { customReleaseWords: resolvedWords } : {}),
    };

    this.ctx.state.set(tool);
    await this.ctx.state.save();
  }
}

export function packageUnsupportedMessage(ctx: AppContext): string {
  const detected = ctx.platform.system;
  const label = detected.charAt(0).toUpperCase() + detected.slice(1);
  return `Package installation is only supported on Linux (detected: ${label})`;
}

// Re-exported for compatibility with the Python module layout.
export { parseReleaseAsset };
