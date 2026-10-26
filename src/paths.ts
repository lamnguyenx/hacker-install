import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { ensureDir } from "./fs-utils.ts";

export const APP_NAMESPACE = join("hacker", "hacker-install-ts");

export interface AppPaths {
  home: string;
  configDir: string;
  configFile: string;
  stateDir: string;
  stateFile: string;
}

function xdgHome(
  env: Record<string, string | undefined>,
  variable: string,
  fallback: string,
  home: string,
): string {
  const value = env[variable];
  if (value && isAbsolute(value)) return value;
  return join(home, fallback);
}

export function resolvePaths(
  env: Record<string, string | undefined> = process.env,
  home = homedir(),
): AppPaths {
  const configBase =
    env.HI_CONFIG_DIR ?? join(xdgHome(env, "XDG_CONFIG_HOME", ".config", home), APP_NAMESPACE);
  const stateBase =
    env.HI_STATE_DIR ??
    join(xdgHome(env, "XDG_STATE_HOME", join(".local", "state"), home), APP_NAMESPACE);

  return {
    home,
    configDir: configBase,
    configFile: join(configBase, "config.jsonc"),
    stateDir: stateBase,
    stateFile: join(stateBase, "state.json"),
  };
}

export async function ensurePaths(paths: AppPaths): Promise<void> {
  await ensureDir(paths.configDir, 0o700);
  await ensureDir(paths.stateDir, 0o700);
}
