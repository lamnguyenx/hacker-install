import { Command, CommanderError } from "commander";
import {
  detectShell,
  installCompletion,
  type SupportedShell,
  showCompletion,
} from "./app/completion.ts";
import { configure } from "./app/config.ts";
import { get } from "./app/get.ts";
import { getInfo, holdTool, listInstalled, pullState, remove, showState } from "./app/manage.ts";
import { me } from "./app/me.ts";
import { upgrade } from "./app/upgrade.ts";
import { type AppContext, createContext } from "./context.ts";
import { CliError } from "./errors.ts";
import { errorMessage } from "./utils.ts";

const SHELLS = new Set(["bash", "zsh", "fish", "powershell"]);

function shellValue(value: string | undefined): SupportedShell {
  const shell = (value ?? detectShell()).toLowerCase();
  if (!SHELLS.has(shell)) {
    throw new CliError(`Unsupported shell: ${shell}. Use bash, zsh, fish or powershell.`);
  }
  return shell as SupportedShell;
}

function applyLogging(ctx: AppContext, options: { verbose?: boolean; quiet?: boolean }): void {
  if (options.verbose) ctx.logger.setLevel("debug");
  else if (options.quiet) ctx.logger.setLevel("error");
}

interface ParsedGetUrl {
  url: string;
  tag: string;
}

export function parseInlineTag(url: string, explicitTag: string): ParsedGetUrl {
  if (explicitTag) return { url, tag: explicitTag };

  if (url.startsWith("mise@")) {
    const suffix = url.slice("mise@".length);
    const colon = suffix.lastIndexOf(":");
    if (colon > 0) {
      return {
        url: `mise@${suffix.slice(0, colon)}`,
        tag: suffix.slice(colon + 1),
      };
    }
    return { url, tag: "" };
  }

  if (url.startsWith("docker@")) {
    const suffix = url.slice("docker@".length);
    const lastSlash = suffix.lastIndexOf("/");
    const lastColon = suffix.lastIndexOf(":");
    if (lastColon > lastSlash) {
      return {
        url: `docker@${suffix.slice(0, lastColon)}`,
        tag: suffix.slice(lastColon + 1),
      };
    }
    return { url, tag: "" };
  }

  return { url, tag: "" };
}

export function findCompletionFlag(
  args: string[],
): { mode: "install" | "show"; shell?: string } | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    for (const mode of ["install", "show"] as const) {
      const flag = `--${mode}-completion`;
      if (arg === flag) {
        const next = args[index + 1];
        const shell = next && !next.startsWith("-") ? next : undefined;
        return { mode, shell };
      }
      if (arg.startsWith(`${flag}=`)) {
        return { mode, shell: arg.slice(flag.length + 1) };
      }
    }
  }
  return null;
}

export function buildProgram(ctx: AppContext): Command {
  const program = new Command("hi")
    .description(
      "Hacker Install - GitHub / GitLab / Codeberg / mise / Docker release installer (Linux/macOS). " +
        "Repo: https://github.com/lamnguyenx/hacker-install",
    )
    .showHelpAfterError()
    .action(() => {
      program.help();
    });

  program
    .command("get")
    .description("Install CLI tool from GitHub/GitLab/Codeberg releases, mise registry or Docker")
    .argument(
      "<url>",
      "GitHub/GitLab/Codeberg URL, gitlab@<host>/..., forgejo@<host>/..., mise@<tool> or docker@<image>",
    )
    .option("-t, --tag <tag>", "Select a specific release version")
    .option("-f, --file <file>", "Select a specific release asset filename")
    .option("-n, --name <name>", "Custom name to save the tool as")
    .option("-y, --yes", "Approve without prompt")
    .option("--pkg", "Install as OS package (deb/rpm/appimage)")
    .option("--docker-opts <opts>", "Extra options to pass to the docker run command")
    .option("-v, --verbose", "Enable verbose mode")
    .option("-q, --quiet", "Enable quiet mode")
    .action(async (url: string, options) => {
      applyLogging(ctx, options);
      const parsed = parseInlineTag(url, options.tag ?? "");
      await get(ctx, {
        url: parsed.url,
        version: parsed.tag,
        assetFile: options.file ?? "",
        prompt: !options.yes,
        name: options.name ?? "",
        pkg: Boolean(options.pkg),
        hold: Boolean(parsed.tag),
        dockerOpts: options.dockerOpts ?? null,
      });
    });

  program
    .command("upgrade")
    .description("Upgrade all installed CLI tools from their repositories")
    .argument("[name]", "Name of a specific installed tool to upgrade")
    .option("-F, --force", "Force upgrade even when the version is unchanged")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--pkg", "Upgrade only packages (not binaries)")
    .option("-v, --verbose", "Enable verbose mode")
    .option("-q, --quiet", "Enable quiet mode")
    .action(async (name: string | undefined, options) => {
      applyLogging(ctx, options);
      await upgrade(ctx, {
        name,
        force: Boolean(options.force),
        skipPrompt: Boolean(options.yes),
        packagesOnly: Boolean(options.pkg),
      });
    });

  program
    .command("ls")
    .description("List all installed CLI tools")
    .option("--hold", "List tools that are kept on hold")
    .option("--json", "Print installed tools as JSON for scripting")
    .action((options) => {
      listInstalled(ctx, {
        holdUpdate: Boolean(options.hold),
        asJson: Boolean(options.json),
      });
    });

  program
    .command("info")
    .description("Show info about an installed CLI tool")
    .argument("<name>", "CLI command name")
    .action((name: string) => {
      getInfo(ctx, name);
    });

  program
    .command("rm")
    .description("Remove any installed CLI tool")
    .argument("[name]", "Name of installed tool to remove")
    .option("-v, --verbose", "Enable verbose mode")
    .action(async (name: string | undefined, options) => {
      applyLogging(ctx, options);
      await remove(ctx, name ?? "");
    });

  program
    .command("config")
    .description("Set configs for Hacker Install")
    .option("--github-token <token>", "Set your GitHub token")
    .option("--gitlab-token <token>", "Set your GitLab token")
    .option("--codeberg-token <token>", "Set your Codeberg/Forgejo token")
    .option("--host <host>", "Host the GitLab/Codeberg token belongs to")
    .option("--path <path>", "Set install path")
    .option("--bundle-path <path>", "Set directory for directory-wrapped release bundles")
    .option("--pre-release", "Include pre-releases when checking for updates", undefined)
    .option("--no-pre-release", "Exclude pre-releases when checking for updates", undefined)
    .option("-v, --verbose", "Enable verbose mode")
    .action(async (options) => {
      applyLogging(ctx, options);
      await configure(ctx, {
        githubToken: options.githubToken,
        gitlabToken: options.gitlabToken,
        codebergToken: options.codebergToken,
        host: options.host,
        path: options.path,
        bundlePath: options.bundlePath,
        preRelease: options.preRelease,
      });
    });

  program
    .command("state")
    .description("Show the current stored state of Hacker Install")
    .option("-v, --verbose", "Enable verbose mode")
    .action(async (options) => {
      applyLogging(ctx, options);
      await showState(ctx);
    });

  program
    .command("pull")
    .description("Install tools from a remote state URL")
    .requiredOption("--url <url>", "Install tools from a remote state URL")
    .option("-O, --override", "Override local tool version with the remote state version")
    .option("-v, --verbose", "Enable verbose mode")
    .action(async (options) => {
      applyLogging(ctx, options);
      await pullState(ctx, { url: options.url, override: Boolean(options.override) });
    });

  program
    .command("hold")
    .description("Keep an installed CLI tool's updates on hold")
    .argument("[name]", "Name of CLI tool for which updates will be kept on hold")
    .option("--unset", "Remove from hold")
    .action(async (name: string | undefined, options) => {
      await holdTool(ctx, name ?? "", !options.unset);
    });

  program
    .command("me")
    .description("Update the Hacker Install tool")
    .option("-U, --upgrade", "Update the Hacker Install tool")
    .option("--version", "Print the Hacker Install version")
    .action(async (options) => {
      await me(ctx, {
        update: Boolean(options.upgrade),
        version: Boolean(options.version),
      });
    });

  return program;
}

export async function runCli(
  argv: string[],
  ctx: AppContext,
  options: { exitOverride?: boolean } = {},
): Promise<number> {
  try {
    if (argv[2] === "-V" || argv[2] === "--version") {
      ctx.io.print(ctx.version);
      return 0;
    }

    const completion = findCompletionFlag(argv.slice(2));
    if (completion) {
      const shell = shellValue(completion.shell);
      if (completion.mode === "install") {
        await installCompletion(ctx, shell);
      } else {
        showCompletion(ctx, shell);
      }
      return 0;
    }

    const program = buildProgram(ctx);
    if (options.exitOverride) program.exitOverride();

    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      if (!options.exitOverride) process.stderr.write(`ERROR    ${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        return 0;
      }
      return error.exitCode;
    }
    if (!options.exitOverride) process.stderr.write(`ERROR    ${errorMessage(error)}\n`);
    return 1;
  }
}

export async function main(argv: string[] = process.argv): Promise<void> {
  try {
    const ctx = await createContext();
    const code = await runCli(argv, ctx);
    if (code !== 0) process.exitCode = code;
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`ERROR    ${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    process.stderr.write(`ERROR    ${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}
