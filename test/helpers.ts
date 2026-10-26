import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { type AppContext, createContext } from "../src/context.ts";
import type { BufferExecResult, ExecOptions, ExecResult, ExecRunner } from "../src/exec.ts";
import { type HttpClient, HttpError, type HttpOptions } from "../src/http.ts";
import { createLogger, type Logger } from "../src/logger.ts";
import type { PlatformInfo } from "../src/platform.ts";
import { type InstalledTool, nowIso } from "../src/schemas.ts";
import type { IO } from "../src/ui/io.ts";

export const TEST_PLATFORM: PlatformInfo = {
  system: "linux",
  arch: "x86_64",
  isGlibc: true,
  packageFamily: "deb",
  hasDesktopEnv: false,
};

export function silentLogger(): Logger {
  return createLogger("error", () => undefined);
}

export class FakeIO implements IO {
  readonly isTTY = false;
  readonly prints: string[] = [];
  readonly errors: string[] = [];
  readonly prompts: string[] = [];
  private answers: string[];

  constructor(answers: string[] = []) {
    this.answers = [...answers];
  }

  print(text = ""): void {
    this.prints.push(text);
  }

  error(text = ""): void {
    this.errors.push(text);
  }

  writeError(text: string): void {
    this.errors.push(text);
  }

  async prompt(question: string): Promise<string> {
    this.prompts.push(question);
    return this.answers.shift() ?? "";
  }

  output(): string {
    return this.prints.join("\n");
  }
}

export interface FakeExecResponse {
  code?: number;
  stdout?: string;
  stderr?: string;
  bytes?: Uint8Array;
}

export type FakeExecHandler = (
  args: string[],
  options: ExecOptions,
) => FakeExecResponse | Promise<FakeExecResponse>;

export class FakeExec implements ExecRunner {
  readonly calls: string[][] = [];
  private handler: FakeExecHandler;

  constructor(handler: FakeExecHandler = () => ({ code: 0 })) {
    this.handler = handler;
  }

  async run(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    return this.runArgs(["/bin/sh", "-c", command], options);
  }

  async runArgs(args: string[], options: ExecOptions = {}): Promise<ExecResult> {
    this.calls.push(args);
    const response = await this.handler(args, options);
    const stdoutText = response.stdout ?? "";
    const stderrText = response.stderr ?? "";
    return {
      stdout: stdoutText.split("\n").filter(Boolean),
      stderr: stderrText.split("\n").filter(Boolean),
      stdoutText,
      stderrText,
      code: response.code ?? 0,
    };
  }

  async captureBytes(args: string[], options: ExecOptions = {}): Promise<BufferExecResult> {
    this.calls.push(args);
    const response = await this.handler(args, options);
    return {
      stdout: response.bytes ?? new TextEncoder().encode(response.stdout ?? ""),
      stderrText: response.stderr ?? "",
      code: response.code ?? 0,
    };
  }
}

export type FakeHttpHandler = (url: string, options: HttpOptions) => Response | Promise<Response>;

export class FakeHttp implements HttpClient {
  readonly requests: Array<{ url: string; options: HttpOptions }> = [];
  private handler: FakeHttpHandler;

  constructor(handler: FakeHttpHandler) {
    this.handler = handler;
  }

  async get(url: string, options: HttpOptions = {}): Promise<Response> {
    this.requests.push({ url, options });
    return this.handler(url, options);
  }

  async getJson<T = unknown>(url: string, options: HttpOptions = {}): Promise<T> {
    const response = await this.get(url, options);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new HttpError(url, response.status, body);
    }
    return (await response.json()) as T;
  }

  async getText(url: string, options: HttpOptions = {}): Promise<string> {
    const response = await this.get(url, options);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new HttpError(url, response.status, body);
    }
    return response.text();
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function textResponse(text: string, status = 200): Response {
  return new Response(text, { status });
}

export interface TestContextOptions {
  io?: IO;
  logger?: Logger;
  http?: HttpClient;
  exec?: ExecRunner;
  platform?: PlatformInfo;
  osPackageType?: "deb" | "rpm" | "AppImage" | "binary" | null;
  env?: Record<string, string | undefined>;
}

export interface TestContextResult {
  ctx: AppContext;
  root: string;
  cleanup: () => Promise<void>;
}

export async function createTestContext(
  options: TestContextOptions = {},
): Promise<TestContextResult> {
  const root = await mkdtemp(join(tmpdir(), "hi-test-"));
  const env = {
    HOME: root,
    HI_CONFIG_DIR: join(root, "config"),
    HI_STATE_DIR: join(root, "state"),
    ...(options.env ?? {}),
  };

  const ctx = await createContext({
    env,
    home: root,
    io: options.io ?? new FakeIO(),
    logger: options.logger ?? silentLogger(),
    http: options.http ?? new FakeHttp(() => jsonResponse({})),
    exec: options.exec ?? new FakeExec(),
    platform: options.platform ?? TEST_PLATFORM,
    osPackageType: options.osPackageType ?? "deb",
  });

  ctx.config.installPath = join(root, "bin");
  ctx.config.bundlePath = join(root, "bundles");
  await ctx.saveConfig();

  return {
    ctx,
    root,
    cleanup: async () => {
      await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
    },
  };
}

export function sampleTool(overrides: Partial<InstalledTool> = {}): InstalledTool {
  return {
    name: "tool",
    provider: "github",
    source: "https://github.com/owner/tool",
    tagName: "v1.0.0",
    publishedAt: "2026-01-01T00:00:00Z",
    prerelease: false,
    description: "A sample tool",
    assets: [],
    holdUpdate: false,
    packageType: "binary",
    installMethod: "binary",
    ...overrides,
  };
}

export async function writeExecutable(
  path: string,
  content = "#!/bin/sh\necho hi\n",
): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, { mode: 0o755 });
  await chmod(path, 0o755);
}

export async function writeElf(path: string, marker = "tool"): Promise<void> {
  const header = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
  const body = new TextEncoder().encode(`\n${marker}\n`);
  const bytes = new Uint8Array(header.length + body.length);
  bytes.set(header);
  bytes.set(body, header.length);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, bytes, { mode: 0o755 });
  await chmod(path, 0o755);
}

export async function writeTarGz(path: string, files: Record<string, string>): Promise<void> {
  const archive = new Bun.Archive(files, { compress: "gzip" });
  await Bun.write(path, archive);
}

export async function writeZip(path: string, files: Record<string, string>): Promise<void> {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] = new TextEncoder().encode(content);
  }
  await Bun.write(path, zipSync(entries));
}

export function newTool(overrides: Partial<InstalledTool> = {}): InstalledTool {
  return sampleTool({ publishedAt: nowIso(), ...overrides });
}
