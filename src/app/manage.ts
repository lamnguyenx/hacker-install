import { join, resolve, sep } from "node:path";
import pc from "picocolors";
import type { AppContext } from "../context.ts";
import { CliError } from "../errors.ts";
import {
  isDirectory,
  isSymlink,
  lexists,
  readTextIfExists,
  realpathOrNull,
  removePath,
  unlinkIfExists,
} from "../fs-utils.ts";
import { PackageInstaller } from "../pkgs/main.ts";
import { type InstalledTool, isPackageTool, parseToolState } from "../schemas.ts";
import { renderTable } from "../ui/table.ts";
import { isNone, isValidToolName } from "../utils.ts";
import { get } from "./get.ts";

export interface ListOptions {
  holdUpdate?: boolean;
  asJson?: boolean;
}

interface ListRow {
  name: string;
  version: string;
  type: string;
  hold: boolean;
  source: string;
  description: string;
}

function rowsFor(ctx: AppContext, options: ListOptions): ListRow[] {
  return ctx.state
    .all()
    .filter((tool) => !options.holdUpdate || tool.holdUpdate)
    .map((tool) => ({
      name: tool.name,
      version: tool.tagName,
      type: isPackageTool(tool) ? tool.packageType : "binary",
      hold: tool.holdUpdate,
      source: tool.source,
      description: tool.description || "",
    }));
}

export function listInstalled(ctx: AppContext, options: ListOptions = {}): void {
  const rows = rowsFor(ctx, options);

  if (options.asJson) {
    ctx.io.print(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    ctx.io.print(pc.dim(options.holdUpdate ? "No tools are kept on hold" : "No tools installed"));
    return;
  }

  const title = options.holdUpdate ? "Installed tools kept on hold" : "Installed tools";
  ctx.io.print(
    renderTable(
      rows.map((row) => ({
        Name: row.name,
        Version: row.version,
        Type: row.type === "binary" ? row.type : pc.cyan(row.type),
        Hold: row.hold ? pc.yellow("yes") : "",
        Source: row.source,
        Description: pc.dim(row.description),
      })),
      {
        title,
        ignoreKeys: options.holdUpdate ? ["Hold"] : [],
        expand: true,
        columnOptions: {
          Name: { minWidth: 4 },
          Version: { minWidth: 7 },
        },
      },
    ),
  );
}

export function getInfo(ctx: AppContext, name: string): void {
  if (!isValidToolName(name)) throw new CliError(`Invalid tool name: ${name}`);
  const tool = ctx.state.get(name);
  if (!tool) {
    throw new CliError(`Tool not found: ${name}`);
  }

  ctx.io.print(
    renderTable(
      [
        {
          Name: tool.name,
          Description: tool.description || "N/A",
          Source: tool.source,
        },
      ],
      { title: `Info: ${name}`, noWrap: false },
    ),
  );
}

export async function remove(ctx: AppContext, name: string): Promise<void> {
  if (!isValidToolName(name)) throw new CliError(`Invalid tool name: ${name}`);
  const tool = ctx.state.get(name);
  if (!tool) {
    ctx.logger.warn(`Tool not found: ${name}`);
    return;
  }

  if (isPackageTool(tool)) {
    if (!tool.packageType || tool.packageType === "binary") {
      ctx.logger.warn(`${name} was not installed as a package`);
    } else {
      const packageName = tool.packageName || name;
      if (packageName !== name) {
        ctx.logger.debug(`Using actual package name '${packageName}' instead of '${name}'`);
      }
      const installer = new PackageInstaller(packageName, {
        packageType: tool.packageType,
        exec: ctx.exec,
        logger: ctx.logger,
      });
      await installer.uninstall();
    }
  } else {
    try {
      const link = join(ctx.installPath, name);
      const bundleRoot = (await realpathOrNull(ctx.bundlePath)) ?? resolve(ctx.bundlePath);
      const bundle = resolve(bundleRoot, name);
      const target = await realpathOrNull(link);
      const isBundle =
        (await isSymlink(link)) &&
        target !== null &&
        (target === bundle || target.startsWith(`${bundle}${sep}`));

      if (await lexists(link)) {
        await unlinkIfExists(link);
        ctx.logger.debug(`Removed file: ${link}`);
      }

      if (isBundle && (await isDirectory(bundle))) {
        await removePath(bundle);
        ctx.logger.debug(`Removed bundle: ${bundle}`);
      }
    } catch (error) {
      ctx.logger.error(`Failed to remove file: ${(error as Error).message}`);
    }
  }

  ctx.state.delete(name);
  await ctx.state.save();
  ctx.logger.info(`Removed: ${name}`);
}

export async function holdTool(ctx: AppContext, name: string, holdUpdate: boolean): Promise<void> {
  if (!isValidToolName(name)) throw new CliError(`Invalid tool name: ${name}`);
  const tool = ctx.state.get(name);
  if (!tool) {
    ctx.logger.warn(`Tool not found: ${name}`);
    return;
  }
  tool.holdUpdate = holdUpdate;
  ctx.state.set(tool);
  await ctx.state.save();
  ctx.logger.info(`Update on hold for, ${name} to ${holdUpdate}`);
}

export async function showState(ctx: AppContext): Promise<void> {
  const text = await readTextIfExists(ctx.paths.stateFile);
  if (!text) return;
  ctx.io.print(text.trimEnd());
}

export interface PullOptions {
  url: string;
  override?: boolean;
}

export async function pullState(ctx: AppContext, options: PullOptions): Promise<void> {
  if (isNone(options.url)) return;

  const raw = await ctx.http.getJson<unknown>(options.url, { timeoutMs: 60_000 });
  const remote = parseToolState(raw);

  const pending: InstalledTool[] = [];
  for (const tool of Object.values(remote.tools)) {
    const local = ctx.state.get(tool.name);
    if (local && (local.tagName === tool.tagName || !options.override)) {
      ctx.logger.debug(`Skipping: ${tool.name}`);
      continue;
    }
    pending.push(tool);
  }

  if (pending.length === 0) return;

  ctx.io.print(
    renderTable(
      pending.map((tool) => ({
        Name: tool.name,
        Version: tool.tagName,
        Type: isPackageTool(tool) ? tool.packageType : "binary",
        Source: tool.source,
      })),
      { title: "Tools to be installed" },
    ),
  );
  ctx.io.print("\nFollowing tool will get Installed.\n");
  const answer = (await ctx.io.prompt("Install these tools, (Y/n): ")).toLowerCase();
  if (answer !== "y" && answer !== "yes") return;

  for (const tool of pending) {
    await get(ctx, {
      url: tool.source,
      version: tool.tagName,
      prompt: false,
      name: tool.name,
      pkg: isPackageTool(tool),
      hold: tool.holdUpdate,
      ...(tool.dockerOpts !== undefined ? { dockerOpts: tool.dockerOpts } : {}),
    });
  }
}
