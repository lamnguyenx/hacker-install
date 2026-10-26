import { createLogger, type Logger } from "../logger.ts";
import { detectPlatformInfo, type PlatformInfo } from "../platform.ts";
import { escapeRegExp, toWords } from "../utils.ts";

export const PLATFORM_ARCH_ALIASES: Record<string, string[]> = {
  x86_64: ["x86", "x64", "amd64", "amd", "x86_64"],
  aarch64: ["arm64", "aarch64", "arm"],
};

export const PLATFORM_ALIASES: Record<string, string[]> = {
  linux: ["linux"],
  darwin: ["darwin", "macos", "mac", "osx", "apple"],
  windows: ["windows", "win32", "win64", "win"],
};

export const PENALTY_SUBSTRINGS = new Set(["debug"]);
export const PENALTY_EXTENSIONS = new Set([
  ".dbg",
  ".json",
  ".jsonl",
  ".spdx",
  ".txt",
  ".yaml",
  ".yml",
  ".md",
  ".snap",
  ".sha1",
  ".sha256",
  ".sha256sum",
  ".sha512",
  ".md5",
  ".sig",
  ".asc",
  ".minisig",
  ".sigstore",
  ".attestation",
  ".msi",
  ".exe",
  ".dmg",
  ".pkg",
]);

function platformRegex(aliases: string[]): string {
  const alternatives = [...aliases]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  return `(?<![a-z0-9])(?:${alternatives})(?![a-z0-9])`;
}

export interface ReleaseScorerOptions {
  extraWords?: string[];
  disableAdjustments?: boolean;
  platform?: Partial<PlatformInfo>;
  logger?: Logger;
}

function isCompletePlatform(value: Partial<PlatformInfo> | undefined): value is PlatformInfo {
  return (
    value !== undefined &&
    typeof value.system === "string" &&
    typeof value.arch === "string" &&
    typeof value.isGlibc === "boolean" &&
    (value.packageFamily === null ||
      value.packageFamily === "deb" ||
      value.packageFamily === "rpm") &&
    typeof value.hasDesktopEnv === "boolean"
  );
}

export class ReleaseScorer {
  readonly platform: string;
  readonly architecture: string;
  readonly isGlibc: boolean;
  readonly packageFamily: "deb" | "rpm" | null;
  readonly extraWords: string[];
  readonly disableAdjustments: boolean;
  private readonly hasDesktopEnv: boolean;
  private readonly extraWordsSet: Set<string>;
  private readonly foreignPlatformPatterns: Record<string, string>;
  private readonly plainPatterns = new Map<string, number>();
  private readonly regexPatterns = new Map<string, number>();
  private totalWeight = 0;
  private readonly logger: Logger;

  constructor(options: ReleaseScorerOptions = {}) {
    const detected = isCompletePlatform(options.platform) ? options.platform : detectPlatformInfo();
    const info: PlatformInfo = { ...detected, ...(options.platform ?? {}) };
    this.platform = info.system;
    this.architecture = info.arch;
    this.isGlibc = info.isGlibc;
    this.packageFamily = info.packageFamily;
    this.hasDesktopEnv = info.hasDesktopEnv;
    this.extraWords = options.extraWords ?? [];
    this.disableAdjustments = options.disableAdjustments ?? false;
    this.extraWordsSet = new Set(this.extraWords.map((word) => word.toLowerCase()));
    this.logger = options.logger ?? createLogger("info");

    this.foreignPlatformPatterns = Object.fromEntries(
      Object.entries(PLATFORM_ALIASES)
        .filter(([other]) => other !== this.platform)
        .map(([other, aliases]) => [other, platformRegex(aliases)]),
    );

    this.buildPatterns();
    this.totalWeight = this.sumWeights();

    this.logger.debug(
      `Platform: ${this.platform}, Arch: ${this.architecture}, glibc: ${this.isGlibc}, ` +
        `package_family: ${this.packageFamily}`,
    );
    this.logger.debug(
      `Plain patterns: ${JSON.stringify([...this.plainPatterns])}, ` +
        `Regex patterns: ${JSON.stringify([...this.regexPatterns])}`,
    );
  }

  private sumWeights(): number {
    return (
      [...this.plainPatterns.values()].reduce((sum, value) => sum + value, 0) +
      [...this.regexPatterns.values()].reduce((sum, value) => sum + value, 0)
    );
  }

  private buildPatterns(): void {
    this.regexPatterns.set(platformRegex(PLATFORM_ALIASES[this.platform] ?? [this.platform]), 5.0);

    let archMatched = false;
    for (const aliases of Object.values(PLATFORM_ARCH_ALIASES)) {
      if (aliases.includes(this.architecture)) {
        for (const alias of aliases) this.plainPatterns.set(alias, 3.0);
        archMatched = true;
        break;
      }
    }
    if (!archMatched) {
      this.logger.warn(
        `Architecture '${this.architecture}' not found in PLATFORM_ARCH_ALIASES; no arch patterns will be applied.`,
      );
    }

    if (!this.isGlibc) this.plainPatterns.set("musl", 2.0);

    this.regexPatterns.set("\\.(tar|zip|gz|bz2|xz|7z)", 2.0);

    for (const word of this.extraWords) this.plainPatterns.set(word, 2.0);
  }

  private assetPackageType(nameLower: string): string | null {
    if (nameLower.endsWith(".deb")) return "deb";
    if (nameLower.endsWith(".rpm")) return "rpm";
    if (nameLower.endsWith(".appimage")) return "AppImage";
    return null;
  }

  private requestedPackageType(): string | null {
    for (const packageType of ["deb", "rpm", "appimage"]) {
      if (this.extraWordsSet.has(packageType)) {
        return packageType === "appimage" ? "AppImage" : packageType;
      }
    }
    return null;
  }

  isPenalised(nameLower: string): boolean {
    for (const extension of PENALTY_EXTENSIONS) {
      if (nameLower.endsWith(extension)) return true;
    }
    for (const substring of PENALTY_SUBSTRINGS) {
      if (nameLower.includes(substring)) return true;
    }
    return false;
  }

  private matchWeight(nameLower: string): number {
    let weight = 0;
    for (const [pattern, value] of this.plainPatterns) {
      if (nameLower.includes(pattern)) weight += value;
    }
    for (const [pattern, value] of this.regexPatterns) {
      if (new RegExp(pattern).test(nameLower)) weight += value;
    }
    return weight;
  }

  score(releaseName: string): number {
    const nameLower = releaseName.toLowerCase();
    const baseScore = this.totalWeight > 0 ? this.matchWeight(nameLower) / this.totalWeight : 0;
    const finalScore = this.disableAdjustments ? baseScore : this.adjustScore(baseScore, nameLower);
    const clamped = Math.max(0, Math.min(1, finalScore));
    this.logger.debug(
      `'${releaseName}': base=${baseScore.toFixed(3)}, final=${clamped.toFixed(3)}`,
    );
    return clamped;
  }

  private adjustScore(baseScore: number, nameLower: string): number {
    let score = baseScore;

    if (this.isGlibc) {
      if (nameLower.includes("musl")) {
        score *= 0.7;
        this.logger.debug(`Applied musl penalty -> ${score.toFixed(3)}`);
      } else if (nameLower.includes("glibc") || nameLower.includes("gnu")) {
        score *= 1.1;
        this.logger.debug(`Applied glibc bonus -> ${score.toFixed(3)}`);
      }
    }

    for (const [other, pattern] of Object.entries(this.foreignPlatformPatterns)) {
      if (new RegExp(pattern).test(nameLower)) {
        score *= 0.05;
        this.logger.debug(`Applied foreign-platform penalty for '${other}' -> ${score.toFixed(3)}`);
        break;
      }
    }

    let triggered: string | null = null;
    for (const extension of PENALTY_EXTENSIONS) {
      if (nameLower.endsWith(extension)) {
        triggered = extension;
        break;
      }
    }
    if (!triggered) {
      for (const substring of PENALTY_SUBSTRINGS) {
        if (nameLower.includes(substring)) {
          triggered = substring;
          break;
        }
      }
    }
    if (triggered) {
      score *= 0.5;
      this.logger.debug(`Applied penalty for '${triggered}' -> ${score.toFixed(3)}`);
    }

    const packageType = this.assetPackageType(nameLower);
    const requested = this.requestedPackageType();
    if (packageType === "deb" || packageType === "rpm") {
      if (requested !== "deb" && requested !== "rpm") {
        score *= 0.2;
        this.logger.debug(
          `Applied native package penalty for '${packageType}' without --pkg hint -> ${score.toFixed(3)}`,
        );
      } else if (packageType !== requested) {
        score *= 0.1;
        this.logger.debug(
          `Applied requested package mismatch penalty: wanted ${requested}, got ${packageType} -> ${score.toFixed(3)}`,
        );
      }

      if (this.packageFamily && packageType !== this.packageFamily) {
        score *= 0.1;
        this.logger.debug(
          `Applied distro compatibility penalty: ${packageType} on ${this.packageFamily} system -> ${score.toFixed(3)}`,
        );
      }
    }

    if (packageType === "AppImage" && !this.hasDesktopEnv) {
      score *= 0.01;
      this.logger.debug(
        `Applied AppImage penalty: no desktop env (XDG_SESSION_DESKTOP not set) -> ${score.toFixed(3)}`,
      );
    }

    return score;
  }

  private effectiveTotalWeight(releaseNames: string[]): number {
    const namesLower = releaseNames.map((name) => name.toLowerCase());
    let effective = 0;

    for (const [pattern, weight] of this.plainPatterns) {
      if (namesLower.some((name) => name.includes(pattern))) effective += weight;
    }
    for (const [pattern, weight] of this.regexPatterns) {
      if (namesLower.some((name) => new RegExp(pattern).test(name))) effective += weight;
    }

    return effective > 0 ? effective : this.totalWeight;
  }

  selectBest(releaseNames: string[], minScore = 0.2): string | null {
    if (releaseNames.length === 0) return null;

    const originalTotal = this.totalWeight;
    const effective = this.effectiveTotalWeight(releaseNames);
    if (effective !== originalTotal) {
      this.logger.debug(
        `Adjusted normalization weight: ${originalTotal} -> ${effective} ` +
          `(some patterns not present in any asset)`,
      );
      this.totalWeight = effective;
    }

    let scored: Array<[string, number]>;
    try {
      scored = this.scoreMultiple(releaseNames);
      this.logger.debug(`Top 3 scores: ${JSON.stringify(scored.slice(0, 3))}`);
    } finally {
      this.totalWeight = originalTotal;
    }

    if (scored.length === 1) {
      this.logger.info(`Only one asset available, selecting: '${scored[0]?.[0]}'`);
      return scored[0]?.[0] ?? null;
    }

    const valid = scored.filter(([, score]) => score >= minScore);
    if (valid.length === 0) {
      this.logger.debug(`No releases scored above ${minScore}`);
      return null;
    }

    const best = valid[0];
    if (!best) return null;

    if (this.disableAdjustments && this.extraWordsSet.size > 0) {
      for (const [name] of valid) {
        const releaseWords = new Set(toWords(name, ["v", "unknown"]));
        const allPresent = [...this.extraWordsSet].every((word) => releaseWords.has(word));
        if (allPresent) {
          this.logger.debug(
            `Exact word match: '${name}' contains all words ${JSON.stringify(this.extraWords)}`,
          );
          return name;
        }
      }
    }

    this.logger.debug(`Selected: '${best[0]}' (score: ${best[1].toFixed(3)})`);
    return best[0];
  }

  scoreMultiple(releaseNames: string[]): Array<[string, number]> {
    return releaseNames
      .map((name): [string, number] => [name, this.score(name)])
      .sort((a, b) => b[1] - a[1]);
  }

  getInfo(): Record<string, unknown> {
    const allPatterns = Object.fromEntries([
      ...this.plainPatterns.entries(),
      ...this.regexPatterns.entries(),
    ]);
    return {
      platformWords: Object.keys(allPatterns),
      extraWords: this.extraWords,
      allPatterns: Object.keys(allPatterns),
      patternWeights: allPatterns,
      isGlibcSystem: this.isGlibc,
      platform: this.platform,
      architecture: this.architecture,
      packageFamily: this.packageFamily,
    };
  }
}
