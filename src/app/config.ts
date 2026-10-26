import type { AppContext } from "../context.ts";

export interface ConfigureInput {
  githubToken?: string;
  gitlabToken?: string;
  codebergToken?: string;
  host?: string;
  path?: string;
  bundlePath?: string;
  preRelease?: boolean;
}

export async function configure(ctx: AppContext, input: ConfigureInput): Promise<void> {
  ctx.logger.info(`Loading config: ${ctx.paths.configFile}`);

  if (input.githubToken) {
    ctx.config.tokens.github = input.githubToken;
    ctx.logger.info("Updated GitHub token");
  }
  if (input.gitlabToken) {
    const host = input.host || "gitlab.com";
    ctx.config.tokens.gitlab[host] = input.gitlabToken;
    ctx.logger.info(`Updated GitLab token for ${host}`);
  }
  if (input.codebergToken) {
    const host = input.host || "codeberg.org";
    ctx.config.tokens.forgejo[host] = input.codebergToken;
    ctx.logger.info(`Updated Codeberg/Forgejo token for ${host}`);
  }
  if (input.path) {
    ctx.config.installPath = input.path;
    ctx.logger.info(`Updated path to:  ${input.path}`);
  }
  if (input.bundlePath) {
    ctx.config.bundlePath = input.bundlePath;
    ctx.logger.info(`Updated bundle path to ${input.bundlePath}`);
  }
  if (input.preRelease !== undefined) {
    ctx.config.preRelease = input.preRelease;
    ctx.logger.info(`Pre-release updates: ${input.preRelease ? "enabled" : "disabled"}`);
  }

  await ctx.saveConfig();
  ctx.logger.info("Done");
}
