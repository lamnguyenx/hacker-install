import { afterEach, describe, expect, test } from "bun:test";
import {
  getInfo,
  holdTool,
  listInstalled,
  pullState,
  remove,
  showState,
} from "../src/app/manage.ts";
import { CliError } from "../src/errors.ts";
import {
  createTestContext,
  FakeExec,
  FakeHttp,
  FakeIO,
  jsonResponse,
  sampleTool,
} from "./helpers.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("list/info/hold/state", () => {
  test("lists tools as JSON", async () => {
    const io = new FakeIO();
    const { ctx, cleanup } = await createTestContext({ io });
    cleanups.push(cleanup);
    ctx.state.set(sampleTool({ name: "a", tagName: "v1" }));
    ctx.state.set(
      sampleTool({
        name: "b",
        tagName: "v2",
        holdUpdate: true,
        packageType: "deb",
        installMethod: "package",
      }),
    );
    await ctx.state.save();

    listInstalled(ctx, { asJson: true });
    const parsed = JSON.parse(io.prints[0] ?? "[]");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      name: "a",
      version: "v1",
      type: "binary",
      hold: false,
      source: "https://github.com/owner/tool",
      description: "A sample tool",
    });
    expect(parsed[1].type).toBe("deb");
  });

  test("filters held tools", async () => {
    const io = new FakeIO();
    const { ctx, cleanup } = await createTestContext({ io });
    cleanups.push(cleanup);
    ctx.state.set(sampleTool({ name: "a" }));
    ctx.state.set(sampleTool({ name: "b", holdUpdate: true }));
    listInstalled(ctx, { holdUpdate: true, asJson: true });
    expect(JSON.parse(io.prints[0] ?? "[]").map((row: any) => row.name)).toEqual(["b"]);
  });

  test("info prints a tool and throws when missing", async () => {
    const io = new FakeIO();
    const { ctx, cleanup } = await createTestContext({ io });
    cleanups.push(cleanup);
    ctx.state.set(sampleTool({ name: "a", description: "desc" }));
    getInfo(ctx, "a");
    expect(io.output()).toContain("desc");
    expect(() => getInfo(ctx, "missing")).toThrow(CliError);
  });

  test("hold toggles the flag and saves", async () => {
    const { ctx, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    ctx.state.set(sampleTool({ name: "a" }));
    await ctx.state.save();

    await holdTool(ctx, "a", true);
    expect(ctx.state.get("a")?.holdUpdate).toBe(true);
    await holdTool(ctx, "a", false);
    expect(ctx.state.get("a")?.holdUpdate).toBe(false);
  });

  test("state prints raw JSON", async () => {
    const io = new FakeIO();
    const { ctx, cleanup } = await createTestContext({ io });
    cleanups.push(cleanup);
    ctx.state.set(sampleTool({ name: "a" }));
    await ctx.state.save();
    await showState(ctx);
    expect(io.output()).toContain('"tools"');
  });
});

describe("remove", () => {
  test("rejects path traversal in tool names", async () => {
    const { ctx, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    await expect(remove(ctx, "../escape")).rejects.toThrow("Invalid tool name");
  });

  test("removes a binary and clears state", async () => {
    const { ctx, root, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    const { writeElf } = await import("./helpers.ts");
    await writeElf(`${root}/bin/a`);
    ctx.state.set(sampleTool({ name: "a" }));
    await ctx.state.save();

    await remove(ctx, "a");
    expect(ctx.state.get("a")).toBeUndefined();
    await expect(
      import("node:fs/promises").then(({ stat }) => stat(`${root}/bin/a`)),
    ).rejects.toThrow();
  });

  test("uninstalls deb packages using metadata name", async () => {
    const exec = new FakeExec((args) => {
      if (args[0] === "sudo" && args[1] === "apt") return { code: 0 };
      return { code: 0 };
    });
    const { ctx, cleanup } = await createTestContext({ exec });
    cleanups.push(cleanup);
    ctx.state.set(
      sampleTool({
        name: "rio",
        installMethod: "package",
        packageType: "deb",
        packageName: "rioterm",
      }),
    );
    await ctx.state.save();

    await remove(ctx, "rio");
    expect(exec.calls.some((args) => args.includes("rioterm") && args.includes("remove"))).toBe(
      true,
    );
    expect(ctx.state.get("rio")).toBeUndefined();
  });
});

describe("pull", () => {
  test("installs missing Docker tools from a remote state", async () => {
    const io = new FakeIO(["y"]);
    const exec = new FakeExec((args) => {
      if (args[0] === "docker" && args[1] === "pull") return { code: 0 };
      if (args[0] === "docker" && args[1] === "inspect") return { stdout: "null" };
      return { code: 0 };
    });
    const remote = {
      version: 1,
      tools: {
        alpine: sampleTool({
          name: "alpine",
          provider: "docker",
          source: "docker@alpine",
          tagName: "latest",
          description: "",
        }),
      },
    };
    const http = new FakeHttp(() => jsonResponse(remote));
    const { ctx, root, cleanup } = await createTestContext({ io, exec, http });
    cleanups.push(cleanup);

    await pullState(ctx, { url: "https://example.com/state.json" });
    expect(ctx.state.get("alpine")?.provider).toBe("docker");
    expect(io.output()).toContain("Tools to be installed");
    expect(
      await import("node:fs/promises").then(({ stat }) => stat(`${root}/bin/alpine`)),
    ).toBeDefined();
  });

  test("skips tools that are already at the same version", async () => {
    const io = new FakeIO(["y"]);
    const http = new FakeHttp(() =>
      jsonResponse({
        version: 1,
        tools: {
          a: sampleTool({ name: "a", tagName: "v1" }),
        },
      }),
    );
    const { ctx, cleanup } = await createTestContext({ io, http });
    cleanups.push(cleanup);
    ctx.state.set(sampleTool({ name: "a", tagName: "v1" }));
    await ctx.state.save();

    await pullState(ctx, { url: "https://example.com/state.json" });
    expect(io.prompts).toHaveLength(0);
  });

  test("override reinstalls a different remote tag", async () => {
    const io = new FakeIO(["n"]);
    const http = new FakeHttp(() =>
      jsonResponse({
        version: 1,
        tools: {
          a: sampleTool({ name: "a", tagName: "v2" }),
        },
      }),
    );
    const { ctx, cleanup } = await createTestContext({ io, http });
    cleanups.push(cleanup);
    ctx.state.set(sampleTool({ name: "a", tagName: "v1" }));
    await ctx.state.save();

    await pullState(ctx, { url: "https://example.com/state.json", override: true });
    expect(io.output()).toContain("Tools to be installed");
    expect(io.prompts).toHaveLength(1);
  });
});
