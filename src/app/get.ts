import type { AppContext } from "../context.ts";
import { CliError } from "../errors.ts";
import { DockerInteractProvider } from "../providers/docker/main.ts";
import { GitInteractProvider, getRepoInfo } from "../providers/git/main.ts";
import { MiseInteractProvider } from "../providers/mise/main.ts";
import { isValidToolName } from "../utils.ts";

export interface GetInput {
  url: string;
  version?: string;
  assetFile?: string;
  local?: boolean;
  prompt?: boolean;
  name?: string;
  pkg?: boolean;
  hold?: boolean;
  dockerOpts?: string | null;
}

export async function get(ctx: AppContext, input: GetInput): Promise<void> {
  const url = input.url;
  const isMise = url.startsWith("mise@") || url.startsWith("mise:");
  const isDocker = url.startsWith("docker@") || url.startsWith("docker:");
  const dockerOpts = input.dockerOpts;

  if (input.name && !isValidToolName(input.name)) {
    throw new CliError(`Invalid tool name: ${input.name}`);
  }

  if (dockerOpts && !isDocker) {
    ctx.logger.warn("--docker-opts is only supported for docker images and will be ignored.");
  }

  const common = {
    version: input.version ?? "",
    local: input.local ?? true,
    prompt: input.prompt ?? false,
    name: input.name ?? "",
    hold: input.hold ?? false,
  };

  if (isMise) {
    const toolname = url.replace(/^mise[@:]/, "");
    await new MiseInteractProvider(toolname, ctx).get(common);
    return;
  }

  if (isDocker) {
    const imageRef = url.replace(/^docker[@:]/, "");
    await new DockerInteractProvider(imageRef, ctx).get({
      ...common,
      dockerOpts: dockerOpts ?? undefined,
    });
    return;
  }

  const repo = await getRepoInfo(ctx, url);
  await new GitInteractProvider(repo, ctx, input.pkg ?? false).get({
    ...common,
    assetFile: input.assetFile ?? "",
    dockerOpts: dockerOpts ?? undefined,
  });
}
