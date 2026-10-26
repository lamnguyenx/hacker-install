import type { AppContext } from "../context.ts";
import { needsUpdate } from "../providers/docker/main.ts";
import { getRepoInfo } from "../providers/git/main.ts";
import { MiseInteractProvider } from "../providers/mise/main.ts";
import { type InstalledTool, isPackageTool, parsePublishedDate } from "../schemas.ts";
import { errorMessage, mapConcurrent } from "../utils.ts";
import { get } from "./get.ts";

export interface UpgradeInput {
  name?: string;
  force?: boolean;
  skipPrompt?: boolean;
  packagesOnly?: boolean;
}

interface UpgradeEntry {
  source: string;
  newVersion: string;
  isPackage: boolean;
  dockerOpts?: string;
}

function isNewerVersion(publishedAt: string, current: string, force: boolean): boolean {
  if (force) return true;
  try {
    return parsePublishedDate(publishedAt).getTime() > parsePublishedDate(current).getTime();
  } catch {
    return false;
  }
}

export async function upgrade(ctx: AppContext, input: UpgradeInput = {}): Promise<void> {
  const tools = ctx.state.all().filter((tool) => !input.name || tool.name === input.name);
  const upgrades = new Map<string, UpgradeEntry>();
  const packageUpgrades = new Set<string>();

  await mapConcurrent(tools, 20, async (tool: InstalledTool) => {
    try {
      if (input.packagesOnly && !isPackageTool(tool)) return;
      if (tool.holdUpdate && !input.force) return;

      if (tool.provider === "mise") {
        const toolname = tool.source.replace(/^mise[@:]/, "");
        ctx.io.print(`Fetching: mise@${toolname}`);
        const versions = await new MiseInteractProvider(toolname, ctx).resolve();
        if (versions.length > 0 && (input.force || versions[0] !== tool.tagName)) {
          upgrades.set(tool.name, {
            source: tool.source,
            newVersion: versions[0] as string,
            isPackage: false,
          });
        }
        return;
      }

      if (tool.provider === "docker") {
        const imageRef = tool.source.replace(/^docker@/, "");
        const cliImage = imageRef.startsWith("library/")
          ? imageRef.slice("library/".length)
          : imageRef;
        ctx.io.print(`Checking: docker@${cliImage}:${tool.tagName}`);
        if (await needsUpdate(ctx.exec, imageRef, tool.tagName, input.force)) {
          upgrades.set(tool.name, {
            source: tool.source,
            newVersion: tool.tagName,
            isPackage: false,
            dockerOpts: tool.dockerOpts,
          });
        }
        return;
      }

      const repo = await getRepoInfo(ctx, tool.source);
      ctx.io.print(`Fetching: ${tool.source}`);
      const releases = await repo.release("", ctx.config.preRelease);
      if (releases.length === 0) {
        ctx.logger.warn(`No releases found for: ${tool.source}`);
        return;
      }
      const newest = releases[0];
      if (!newest) return;

      if (isNewerVersion(newest.publishedAt, tool.publishedAt, input.force ?? false)) {
        if (isPackageTool(tool) && !input.packagesOnly && !input.name) {
          packageUpgrades.add(tool.name);
        } else {
          upgrades.set(tool.name, {
            source: repo.repoUrl,
            newVersion: newest.tagName,
            isPackage: isPackageTool(tool),
            ...(tool.dockerOpts ? { dockerOpts: tool.dockerOpts } : {}),
          });
        }
      }
    } catch (error) {
      ctx.logger.error(`Failed to check ${tool.name}: ${errorMessage(error)}`);
    }
  });

  if (!input.packagesOnly && packageUpgrades.size > 0) {
    ctx.io.print("\nFollowing package can be upgraded.\n");
    ctx.io.print([...packageUpgrades].join(" "));
    ctx.io.print("\nTo upgrade packages, run: hi upgrade --pkg\n");
  }

  if (upgrades.size === 0) {
    ctx.io.print("All tools are onto latest version");
    return;
  }

  ctx.io.print("\nFollowing tool will get upgraded.\n");
  ctx.io.print([...upgrades.keys()].join(" "));
  if (!input.skipPrompt) {
    const answer = (await ctx.io.prompt("\nUpgrade these tools, (Y/n): ")).toLowerCase();
    if (answer !== "y" && answer !== "yes") return;
  }

  const needsSudo =
    input.packagesOnly ||
    (Boolean(input.name) && [...upgrades.values()].some((entry) => entry.isPackage));
  if (needsSudo) {
    ctx.io.print("\n\nNeed sudo access for installing packages...");
    const result = await ctx.exec.runArgs(["sudo", "-v"], { interactive: true });
    if (result.code !== 0) {
      ctx.io.print("Failed to acquire sudo. Aborting.");
      return;
    }
  }

  const entries = [...upgrades.entries()];
  for (let index = 0; index < entries.length; index += 1) {
    const [name, entry] = entries[index] as [string, UpgradeEntry];
    const percent = Math.round(((index + 1) * 100) / entries.length);
    const current = ctx.state.get(name);
    ctx.io.print(
      `(${percent}%) Updating: ${name}, ${current?.tagName ?? "?"} => ${entry.newVersion}`,
    );
    await get(ctx, {
      url: entry.source,
      version: entry.newVersion,
      prompt: false,
      name,
      pkg: entry.isPackage,
      ...(entry.dockerOpts !== undefined ? { dockerOpts: entry.dockerOpts } : {}),
    });
  }
}
