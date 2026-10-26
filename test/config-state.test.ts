import { afterEach, describe, expect, test } from "bun:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configure } from "../src/app/config.ts";
import { resolvePaths } from "../src/paths.ts";
import { defaultConfig, parseConfig, parseToolState } from "../src/schemas.ts";
import { ConfigStore, ToolStateStore } from "../src/state.ts";
import { createTestContext, FakeIO, sampleTool } from "./helpers.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("paths", () => {
  test("uses the hacker-install-ts XDG layout", () => {
    const paths = resolvePaths({}, "/home/u");
    expect(paths.configFile).toBe(
      join("/home/u", ".config", "hacker", "hacker-install-ts", "config.jsonc"),
    );
    expect(paths.stateFile).toBe(
      join("/home/u", ".local", "state", "hacker", "hacker-install-ts", "state.json"),
    );
  });

  test("ignores relative XDG values", () => {
    const paths = resolvePaths(
      { XDG_CONFIG_HOME: "relative/path", XDG_STATE_HOME: "relative/state" },
      "/home/u",
    );
    expect(paths.configFile).toBe(
      join("/home/u", ".config", "hacker", "hacker-install-ts", "config.jsonc"),
    );
    expect(paths.stateFile).toBe(
      join("/home/u", ".local", "state", "hacker", "hacker-install-ts", "state.json"),
    );
  });

  test("honours HI_CONFIG_DIR/HI_STATE_DIR overrides", () => {
    const paths = resolvePaths({ HI_CONFIG_DIR: "/tmp/cfg", HI_STATE_DIR: "/tmp/st" }, "/home/u");
    expect(paths.configFile).toBe("/tmp/cfg/config.jsonc");
    expect(paths.stateFile).toBe("/tmp/st/state.json");
  });
});

describe("config store", () => {
  test("loads JSONC and creates defaults", async () => {
    const { ctx, root, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    expect(ctx.config).toEqual({
      ...defaultConfig(),
      installPath: join(root, "bin"),
      bundlePath: join(root, "bundles"),
    });
    expect(ctx.paths.configFile.startsWith(root)).toBe(true);
  });

  test("config command updates tokens, paths and pre-release", async () => {
    const io = new FakeIO();
    const { ctx, root, cleanup } = await createTestContext({ io });
    cleanups.push(cleanup);

    await configure(ctx, {
      githubToken: "gh",
      gitlabToken: "gl",
      codebergToken: "cb",
      host: "git.example.com",
      path: "~/custom-bin",
      bundlePath: "~/custom-bundles",
      preRelease: true,
    });

    expect(ctx.config.tokens.github).toBe("gh");
    expect(ctx.config.tokens.gitlab["git.example.com"]).toBe("gl");
    expect(ctx.config.tokens.forgejo["git.example.com"]).toBe("cb");
    expect(ctx.config.installPath).toBe("~/custom-bin");
    expect(ctx.config.bundlePath).toBe("~/custom-bundles");
    expect(ctx.config.preRelease).toBe(true);
    expect(ctx.installPath).toBe(join(root, "custom-bin"));

    const saved = JSON.parse(await readFile(ctx.paths.configFile, "utf8"));
    expect(saved.tokens.github).toBe("gh");
    expect((await stat(ctx.paths.configFile)).mode & 0o777).toBe(0o600);
  });

  test("omitting pre-release leaves the previous value", async () => {
    const { ctx, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    ctx.config.preRelease = true;
    await ctx.saveConfig();
    await configure(ctx, { path: "~/bin" });
    expect(ctx.config.preRelease).toBe(true);
  });

  test("rejects a newer config version", async () => {
    const { ctx, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    await writeFile(ctx.paths.configFile, JSON.stringify({ version: 99 }));
    const store = new ConfigStore(ctx.paths.configFile);
    await expect(store.load()).rejects.toThrow("newer than supported");
  });
});

describe("state store", () => {
  test("round-trips tools and preserves camelCase schema", async () => {
    const { ctx, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    const tool = sampleTool({ name: "deno", provider: "github" });
    ctx.state.set(tool);
    await ctx.state.save();

    const loaded = new ToolStateStore(ctx.paths.stateFile);
    await loaded.load();
    expect(loaded.get("deno")).toEqual(tool);
    expect((await stat(ctx.paths.stateFile)).mode & 0o777).toBe(0o600);
  });

  test("parses list-shaped tools for tolerance", () => {
    const state = parseToolState({
      version: 1,
      tools: [sampleTool({ name: "a" }), sampleTool({ name: "b" })],
    });
    expect(Object.keys(state.tools)).toEqual(["a", "b"]);
  });

  test("rejects invalid providers", () => {
    expect(() =>
      parseToolState({ version: 1, tools: { x: { ...sampleTool(), provider: "nope" } } }),
    ).toThrow("Invalid provider");
  });

  test("rejects newer state versions", () => {
    expect(() => parseToolState({ version: 99, tools: {} })).toThrow("newer than supported");
  });

  test("config parser keeps defaults for missing fields", () => {
    expect(parseConfig({})).toEqual(defaultConfig());
  });
});
