import { homedir } from "node:os";
import { BunExecRunner, type ExecRunner } from "./exec.ts";
import { expandHome, pathExists } from "./fs-utils.ts";
import { defaultHttpClient, type HttpClient } from "./http.ts";
import { createLogger, initialLogLevel, type Logger } from "./logger.ts";
import { type AppPaths, ensurePaths, resolvePaths } from "./paths.ts";
import { detectOsPackageType, detectPlatformInfo, type PlatformInfo } from "./platform.ts";
import { defaultConfig, type PackageType, type ToolConfig } from "./schemas.ts";
import { ConfigStore, ToolStateStore } from "./state.ts";
import { ConsoleIO, type IO } from "./ui/io.ts";
import { VERSION } from "./version.ts";

export interface CreateContextOptions {
  env?: Record<string, string | undefined>;
  home?: string;
  io?: IO;
  logger?: Logger;
  http?: HttpClient;
  exec?: ExecRunner;
  platform?: PlatformInfo;
  osPackageType?: PackageType | null;
}

export class AppContext {
  readonly paths: AppPaths;
  readonly configStore: ConfigStore;
  readonly state: ToolStateStore;
  readonly logger: Logger;
  readonly io: IO;
  readonly http: HttpClient;
  readonly exec: ExecRunner;
  readonly platform: PlatformInfo;
  readonly osPackageType: PackageType | null;
  readonly version: string;
  config: ToolConfig;

  constructor(options: {
    paths: AppPaths;
    configStore: ConfigStore;
    state: ToolStateStore;
    logger: Logger;
    io: IO;
    http: HttpClient;
    exec: ExecRunner;
    platform: PlatformInfo;
    osPackageType: PackageType | null;
    config: ToolConfig;
  }) {
    this.paths = options.paths;
    this.configStore = options.configStore;
    this.state = options.state;
    this.logger = options.logger;
    this.io = options.io;
    this.http = options.http;
    this.exec = options.exec;
    this.platform = options.platform;
    this.osPackageType = options.osPackageType;
    this.config = options.config;
    this.version = VERSION;
  }

  get installPath(): string {
    return expandHome(this.config.installPath, this.paths.home);
  }

  get bundlePath(): string {
    return expandHome(this.config.bundlePath, this.paths.home);
  }

  async saveConfig(): Promise<void> {
    this.configStore.config = this.config;
    await this.configStore.save();
  }
}

export async function createContext(options: CreateContextOptions = {}): Promise<AppContext> {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const paths = resolvePaths(env, home);
  await ensurePaths(paths);

  const logger = options.logger ?? createLogger(initialLogLevel(env));
  const configStore = new ConfigStore(paths.configFile);
  const configExists = await pathExists(paths.configFile);
  await configStore.load();
  if (!configExists || !configStore.loadedFromFile) {
    configStore.config = defaultConfig();
    await configStore.save();
  }

  const state = new ToolStateStore(paths.stateFile);
  await state.load();

  const platform = options.platform ?? detectPlatformInfo(env);
  const osPackageType =
    options.osPackageType !== undefined
      ? options.osPackageType
      : platform.system === "linux"
        ? detectOsPackageType(platform.system)
        : null;

  return new AppContext({
    paths,
    configStore,
    state,
    logger,
    io: options.io ?? new ConsoleIO(),
    http: options.http ?? defaultHttpClient,
    exec: options.exec ?? new BunExecRunner(),
    platform,
    osPackageType,
    config: configStore.config,
  });
}
