import { basename } from "node:path";
import type { AppContext } from "../context.ts";
import { isValidToolName } from "../utils.ts";
import { PROJECT_REPO } from "../version.ts";

export function invokedBinaryName(
  execPath = process.execPath,
  argv: string[] = process.argv,
  env: Record<string, string | undefined> = process.env,
  title = process.title,
): string {
  if (env.HI_BINARY_NAME) return env.HI_BINARY_NAME;

  const titleName = basename(title.split(/\s+/)[0] ?? title);
  if (
    titleName &&
    titleName !== "bun" &&
    titleName !== "bun.exe" &&
    titleName !== "node" &&
    titleName !== "node.exe"
  ) {
    return titleName;
  }

  const execName = basename(execPath);
  if (
    execName !== "bun" &&
    execName !== "bun.exe" &&
    execName !== "node" &&
    execName !== "node.exe"
  ) {
    return execName;
  }

  const script = argv[1] ?? "";
  const scriptName = basename(script);
  if (
    !scriptName ||
    scriptName === "index.ts" ||
    scriptName === "index.js" ||
    scriptName === "cli.ts"
  ) {
    return "hi";
  }
  if (scriptName.endsWith(".ts") || scriptName.endsWith(".js")) return "hi";
  return scriptName;
}

export function isGlobalPackageInstall(
  argv: string[] = process.argv,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.HI_BINARY_NAME) return false;
  const script = argv[1] ?? "";
  return (
    script.includes("node_modules") ||
    script.includes(".bun/install/global") ||
    script.includes("dist/npm/")
  );
}

export interface MeOptions {
  update?: boolean;
  version?: boolean;
}

export async function me(ctx: AppContext, options: MeOptions = {}): Promise<void> {
  if (options.update) {
    if (isGlobalPackageInstall()) {
      ctx.io.print(
        "This looks like a global npm/Bun install. Update it with:\n" +
          "  bun update -g hacker-install-ts\n" +
          "  npm update -g hacker-install-ts",
      );
      return;
    }

    const detectedName = invokedBinaryName();
    const name = isValidToolName(detectedName) ? detectedName : "hi";
    const command = `${name} get ${PROJECT_REPO} -n ${name} -y`;
    ctx.io.print(`Running: ${command}`);
    const result = await ctx.exec.run(command, { interactive: true });
    if (result.code !== 0) {
      ctx.io.print(`\nUpdate failed. You can reinstall manually from ${PROJECT_REPO}/releases`);
    }
    return;
  }

  if (options.version) {
    ctx.io.print(ctx.version);
    return;
  }

  ctx.io.print(`Version: ${ctx.version}`);
  ctx.io.print(`Repo:    ${PROJECT_REPO}`);
}
