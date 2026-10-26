import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppContext } from "../../context.ts";
import { CliError } from "../../errors.ts";
import type { ExecRunner } from "../../exec.ts";
import { ensureDir } from "../../fs-utils.ts";
import { type InstalledTool, nowIso } from "../../schemas.ts";
import { renderTable } from "../../ui/table.ts";
import { isValidToolName } from "../../utils.ts";
import { WRAPPER_TEMPLATE } from "./config.ts";
import { DockerImage, splitImageTag } from "./schemas.ts";

export function getLocalDigest(exec: ExecRunner, cliRef: string): Promise<string> {
  return exec
    .runArgs(["docker", "inspect", "--format", "{{index .RepoDigests 0}}", cliRef])
    .then((result) => {
      const raw = result.stdoutText.trim();
      if (!raw || raw === "<no value>" || !raw.includes("@")) return "";
      return raw.split("@").pop() ?? "";
    });
}

export async function getRemoteDigest(exec: ExecRunner, cliRef: string): Promise<string> {
  const result = await exec.runArgs(["docker", "buildx", "imagetools", "inspect", cliRef]);
  for (const line of result.stdoutText.split("\n")) {
    if (line.startsWith("Digest:")) return line.slice("Digest:".length).trim();
  }
  return "";
}

export async function needsUpdate(
  exec: ExecRunner,
  image: string,
  tag: string,
  force = false,
): Promise<boolean> {
  if (force) return true;
  if (tag !== "latest") return false;
  const cliRef = new DockerImage(image, tag).cliRef;
  const local = await getLocalDigest(exec, cliRef);
  if (!local) return true;
  const remote = await getRemoteDigest(exec, cliRef);
  return Boolean(remote) && local !== remote;
}

export async function getEntrypoint(exec: ExecRunner, cliRef: string): Promise<string[]> {
  const result = await exec.runArgs([
    "docker",
    "inspect",
    "--format",
    "{{json .Config.Entrypoint}}",
    cliRef,
  ]);
  const raw = result.stdoutText.trim();
  if (!raw || raw === "null") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export interface DockerGetOptions {
  version?: string;
  local?: boolean;
  prompt?: boolean;
  name?: string;
  dockerOpts?: string | null;
}

export class DockerInteractProvider {
  private readonly ctx: AppContext;
  private readonly image: DockerImage;

  constructor(imageRef: string, ctx: AppContext) {
    this.ctx = ctx;
    const { image, tag } = splitImageTag(imageRef);
    const normalized = image.includes("/") ? image : `library/${image}`;
    this.image = new DockerImage(normalized, tag);
  }

  resolve(version = ""): string[] {
    return [version || this.image.tag];
  }

  select(candidates: string[]): DockerImage | null {
    if (candidates.length === 0) return null;
    return new DockerImage(this.image.image, candidates[0] as string);
  }

  async prompt(toolname: string, candidate: DockerImage): Promise<string> {
    this.ctx.io.print(
      renderTable([{ Tool: toolname, Image: candidate.image, Tag: candidate.tag }], {
        title: `Install ${toolname} (via Docker)`,
      }),
    );
    return (await this.ctx.io.prompt("Install selected tool [Y/n]: ")).trim().toLowerCase() || "y";
  }

  async install(
    candidate: DockerImage,
    toolname: string,
    dockerOpts = "",
    _local = true,
  ): Promise<boolean> {
    this.ctx.io.print(`Pulling ${candidate.cliRef}...`);
    const pull = await this.ctx.exec.runArgs(["docker", "pull", candidate.cliRef], {
      interactive: true,
    });
    if (pull.code !== 0) {
      this.ctx.logger.error(`docker pull failed for ${candidate.cliRef}`);
      return false;
    }

    await ensureDir(this.ctx.installPath, 0o700);
    const scriptPath = join(this.ctx.installPath, toolname);
    const entrypoint = await getEntrypoint(this.ctx.exec, candidate.cliRef);
    const args = entrypoint.length > 0 ? '"$@"' : `${toolname} "$@"`;
    const content = WRAPPER_TEMPLATE.replace("{docker_opts}", dockerOpts)
      .replace("{ref}", candidate.cliRef)
      .replace("{args}", args);

    await writeFile(scriptPath, content, { encoding: "utf8", mode: 0o755 });
    await chmod(scriptPath, 0o755);
    this.ctx.logger.info(`Installed wrapper: ${scriptPath}`);
    return true;
  }

  async get(options: DockerGetOptions = {}): Promise<void> {
    const toolname = options.name || this.image.name;
    if (!isValidToolName(toolname)) {
      throw new CliError(`Invalid tool name: ${toolname}`);
    }
    const candidates = this.resolve(options.version ?? "");
    const image = this.select(candidates);
    if (!image) return;

    const cached = this.ctx.state.get(toolname);
    const sameSource = cached?.source === `docker@${image.cliImage}`;
    const dockerOpts =
      options.dockerOpts === undefined || options.dockerOpts === null
        ? ((sameSource ? cached?.dockerOpts : undefined) ?? "")
        : options.dockerOpts;

    if (options.prompt) {
      const decision = await this.prompt(toolname, image);
      if (decision !== "y") return;
      this.ctx.io.print("\nPulling image...");
    }

    if (!(await this.install(image, toolname, dockerOpts, options.local ?? true))) return;

    const tool: InstalledTool = {
      name: toolname,
      provider: "docker",
      source: `docker@${image.cliImage}`,
      tagName: image.tag,
      publishedAt: nowIso(),
      prerelease: false,
      description: `Docker image wrapper: ${image.cliRef}`,
      assets: [],
      holdUpdate: image.tag !== "latest",
      packageType: "binary",
      installMethod: "binary",
      dockerOpts,
    };

    this.ctx.state.set(tool);
    await this.ctx.state.save();
  }
}
