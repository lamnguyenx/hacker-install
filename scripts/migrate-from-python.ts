#!/usr/bin/env bun
/**
 * One-off migration from the Python hacker-install state/config.
 *
 *   bun run migrate:python
 *   bun run migrate:python -- /path/to/state.json
 *
 * The Python state key format is `<source>#<name>`; Docker uses `docker:` and
 * mise uses `mise:` prefixes, while git providers store a repository URL.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readTextIfExists } from "../src/fs-utils.ts";
import { parseJsonc } from "../src/jsonc.ts";
import { resolvePaths } from "../src/paths.ts";
import { resolveProvider } from "../src/providers/base.ts";
import {
  type InstalledTool,
  normalizeInstallMethod,
  normalizePackageType,
  type ProviderId,
  parseReleaseAsset,
} from "../src/schemas.ts";
import { ConfigStore, ToolStateStore } from "../src/state.ts";

function oldStatePath(): string {
  return join(homedir(), ".local", "state", "hacker", "hacker-install", "state.json");
}

function oldConfigPath(): string {
  return join(homedir(), ".config", "hacker", "hacker-install", "config.jsonc");
}

function providerFor(key: string, url: string): { provider: ProviderId; source: string } {
  if (key.startsWith("mise:")) {
    return { provider: "mise", source: `mise@${key.slice("mise:".length).split("#")[0]}` };
  }
  if (key.startsWith("docker:")) {
    const fromUrl = url.startsWith("docker@") ? url.slice("docker@".length) : "";
    const fromKey = key.slice("docker:".length).split("#")[0] ?? "";
    const image = (fromUrl || fromKey).replace(/^library\//, "");
    return { provider: "docker", source: `docker@${image}` };
  }
  const provider = resolveProvider(url);
  if (!provider) throw new Error(`Cannot determine provider for ${key}`);
  return { provider, source: url };
}

function convertTool(key: string, raw: any): InstalledTool {
  const name = key.includes("#") ? key.slice(key.lastIndexOf("#") + 1) : String(raw.name ?? "");
  const { provider, source } = providerFor(key, String(raw.url ?? ""));
  const assets = Array.isArray(raw.assets) ? raw.assets.map(parseReleaseAsset) : [];
  const tool: InstalledTool = {
    name,
    provider,
    source,
    tagName: String(raw.tag_name ?? ""),
    publishedAt: String(raw.published_at ?? ""),
    prerelease: Boolean(raw.prerelease),
    description: String(raw.description ?? ""),
    assets,
    holdUpdate: Boolean(raw.hold_update),
    packageType: normalizePackageType(raw.package_type),
    installMethod: normalizeInstallMethod(raw.install_method),
  };
  const words = raw.custom_release_words;
  if (Array.isArray(words))
    tool.customReleaseWords = words.filter((word) => typeof word === "string");
  if (typeof raw.package_name === "string") tool.packageName = raw.package_name;
  if (typeof raw.docker_opts === "string") tool.dockerOpts = raw.docker_opts;
  return tool;
}

async function migrateConfig(): Promise<boolean> {
  const oldPath = oldConfigPath();
  const text = await readTextIfExists(oldPath);
  if (!text) return false;

  const parsed = parseJsonc<{ config?: Record<string, any> }>(text);
  const old = parsed.config ?? {};
  const paths = resolvePaths();
  const store = new ConfigStore(paths.configFile);
  await store.load();

  const config = store.config;
  config.installPath = typeof old.path === "string" && old.path ? old.path : config.installPath;
  config.bundlePath =
    typeof old.bundle_path === "string" && old.bundle_path ? old.bundle_path : config.bundlePath;
  config.preRelease = Boolean(old.pre_release ?? config.preRelease);
  if (typeof old.token === "string" && old.token) config.tokens.github = old.token;
  if (typeof old.gitlab_token === "string" && old.gitlab_token) {
    config.tokens.gitlab["gitlab.com"] = old.gitlab_token;
  } else if (old.gitlab_token && typeof old.gitlab_token === "object") {
    config.tokens.gitlab = { ...config.tokens.gitlab, ...old.gitlab_token };
  }
  if (typeof old.codeberg_token === "string" && old.codeberg_token) {
    config.tokens.forgejo["codeberg.org"] = old.codeberg_token;
  } else if (old.codeberg_token && typeof old.codeberg_token === "object") {
    config.tokens.forgejo = { ...config.tokens.forgejo, ...old.codeberg_token };
  }

  store.config = config;
  await store.save();
  console.log(`Migrated config: ${oldPath} -> ${paths.configFile}`);
  return true;
}

async function main(): Promise<void> {
  const input = process.argv[2] ? resolve(process.argv[2]) : oldStatePath();
  const text = await readTextIfExists(input);
  if (!text) {
    console.error(`No Python state file found at ${input}`);
    process.exit(1);
  }

  const rawState = JSON.parse(text) as Record<string, any>;
  const paths = resolvePaths();
  const store = new ToolStateStore(paths.stateFile);
  await store.load();

  let migrated = 0;
  for (const [key, raw] of Object.entries(rawState)) {
    if (!raw || typeof raw !== "object") continue;
    try {
      const tool = convertTool(key, raw);
      if (!tool.name) continue;
      store.set(tool);
      migrated += 1;
    } catch (error) {
      console.warn(`Skipping ${key}: ${(error as Error).message}`);
    }
  }

  await store.save();
  await migrateConfig();
  console.log(`Migrated ${migrated} tool(s) to ${paths.stateFile}`);
  console.log("Python state/config were left untouched.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
