import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { upgrade } from "../src/app/upgrade.ts";
import {
  DockerInteractProvider,
  getEntrypoint,
  needsUpdate,
} from "../src/providers/docker/main.ts";
import { createTestContext, FakeExec, sampleTool } from "./helpers.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function dockerExec(entrypoint = '["/entrypoint"]'): FakeExec {
  return new FakeExec((args) => {
    if (args[0] === "docker" && args[1] === "pull") return { code: 0 };
    if (
      args[0] === "docker" &&
      args[1] === "inspect" &&
      args[3] === "{{json .Config.Entrypoint}}"
    ) {
      return { stdout: entrypoint };
    }
    return { code: 0, stdout: "" };
  });
}

describe("docker provider", () => {
  test("installs a wrapper and saves docker options", async () => {
    const { ctx, root, cleanup } = await createTestContext({ exec: dockerExec() });
    cleanups.push(cleanup);

    const provider = new DockerInteractProvider("alpine:3.19", ctx);
    await provider.get({
      name: "alpine-custom",
      prompt: false,
      dockerOpts: "-v /host/path:/container/path:ro",
    });

    const wrapper = join(root, "bin", "alpine-custom");
    const content = await readFile(wrapper, "utf8");
    expect(content).toContain(
      'docker run --rm -i $termflag -v "$' +
        '{PWD}:/tmp/cmd" -w /tmp/cmd -v /host/path:/container/path:ro',
    );
    expect(content).toContain("alpine:3.19");

    const tool = ctx.state.get("alpine-custom");
    expect(tool?.provider).toBe("docker");
    expect(tool?.source).toBe("docker@alpine");
    expect(tool?.dockerOpts).toBe("-v /host/path:/container/path:ro");
    expect(tool?.holdUpdate).toBe(true);
  });

  test("explicit empty docker options clear stored options", async () => {
    const { ctx, root, cleanup } = await createTestContext({ exec: dockerExec() });
    cleanups.push(cleanup);
    const provider = new DockerInteractProvider("alpine:3.19", ctx);

    await provider.get({ name: "alpine-custom", prompt: false, dockerOpts: "-v /old:/old" });
    await provider.get({ name: "alpine-custom", prompt: false, dockerOpts: "" });

    const content = await readFile(join(root, "bin", "alpine-custom"), "utf8");
    expect(content).not.toContain("-v /old:/old");
    expect(ctx.state.get("alpine-custom")?.dockerOpts).toBe("");
  });

  test("omitted docker options preserve stored options", async () => {
    const { ctx, root, cleanup } = await createTestContext({ exec: dockerExec() });
    cleanups.push(cleanup);
    const provider = new DockerInteractProvider("alpine:3.19", ctx);

    await provider.get({ name: "alpine-custom", prompt: false, dockerOpts: "-v /keep:/keep" });
    await provider.get({ name: "alpine-custom", prompt: false });

    const content = await readFile(join(root, "bin", "alpine-custom"), "utf8");
    expect(content).toContain("-v /keep:/keep");
    expect(ctx.state.get("alpine-custom")?.dockerOpts).toBe("-v /keep:/keep");
  });

  test("wrapper omits the command name when the image has an entrypoint", async () => {
    const { ctx, root, cleanup } = await createTestContext({
      exec: dockerExec('["/entrypoint"]'),
    });
    cleanups.push(cleanup);
    await new DockerInteractProvider("alpine", ctx).get({ name: "a", prompt: false });
    expect(await readFile(join(root, "bin", "a"), "utf8")).toContain('alpine:latest "$@"');
  });

  test("wrapper prepends the tool name without an entrypoint", async () => {
    const { ctx, root, cleanup } = await createTestContext({
      exec: dockerExec("null"),
    });
    cleanups.push(cleanup);
    await new DockerInteractProvider("alpine", ctx).get({ name: "a", prompt: false });
    expect(await readFile(join(root, "bin", "a"), "utf8")).toContain('alpine:latest a "$@"');
  });
});

describe("docker digests", () => {
  test("force, pinned tags and missing local digests", async () => {
    const exec = new FakeExec((args) => {
      if (args.includes("--format")) {
        return { stdout: "<no value>" };
      }
      return { code: 0, stdout: "Digest: sha256:remote\n" };
    });
    expect(await needsUpdate(exec, "alpine", "latest", true)).toBe(true);
    expect(await needsUpdate(exec, "alpine", "3.19", false)).toBe(false);
    expect(await needsUpdate(exec, "alpine", "latest", false)).toBe(true);
  });

  test("compares local and remote digests", async () => {
    const local = new FakeExec((args) => {
      if (args.includes("--format")) return { stdout: "alpine@sha256:abc" };
      return { stdout: "Digest: sha256:def" };
    });
    expect(await needsUpdate(local, "alpine", "latest", false)).toBe(true);

    const same = new FakeExec((args) => {
      if (args.includes("--format")) return { stdout: "alpine@sha256:abc" };
      return { stdout: "Digest: sha256:abc" };
    });
    expect(await needsUpdate(same, "alpine", "latest", false)).toBe(false);

    const unknownRemote = new FakeExec((args) => {
      if (args.includes("--format")) return { stdout: "alpine@sha256:abc" };
      return { stdout: "" };
    });
    expect(await needsUpdate(unknownRemote, "alpine", "latest", false)).toBe(false);
  });

  test("parses entrypoints", async () => {
    expect(
      await getEntrypoint(new FakeExec(() => ({ stdout: '["/bin/sh","-c"]' })), "alpine"),
    ).toEqual(["/bin/sh", "-c"]);
    expect(await getEntrypoint(new FakeExec(() => ({ stdout: "null" })), "alpine")).toEqual([]);
  });
});

describe("docker upgrade", () => {
  test("force upgrade re-pulls and preserves docker options", async () => {
    const exec = dockerExec();
    const io = new (await import("./helpers.ts")).FakeIO();
    const { ctx, root, cleanup } = await createTestContext({ exec, io });
    cleanups.push(cleanup);

    ctx.state.set(
      sampleTool({
        name: "alpine-tool",
        provider: "docker",
        source: "docker@alpine",
        tagName: "latest",
        description: "wrapper",
        holdUpdate: true,
        dockerOpts: "-v /my/data:/data:rw",
      }),
    );
    await ctx.state.save();

    await upgrade(ctx, { name: "alpine-tool", force: true, skipPrompt: true });

    const content = await readFile(join(root, "bin", "alpine-tool"), "utf8");
    expect(content).toContain("-v /my/data:/data:rw");
    expect(ctx.state.get("alpine-tool")?.dockerOpts).toBe("-v /my/data:/data:rw");
  });

  test("upgrade by name checks only the matching tool", async () => {
    const exec = dockerExec();
    const { ctx, cleanup } = await createTestContext({ exec });
    cleanups.push(cleanup);
    ctx.state.set(
      sampleTool({ name: "one", provider: "docker", source: "docker@alpine", tagName: "latest" }),
    );
    ctx.state.set(
      sampleTool({ name: "two", provider: "docker", source: "docker@busybox", tagName: "latest" }),
    );
    await ctx.state.save();

    await upgrade(ctx, { name: "one", force: true, skipPrompt: true });
    const pulls = exec.calls.filter((args) => args[1] === "pull");
    expect(pulls.some((args) => args.includes("alpine:latest"))).toBe(true);
    expect(pulls.some((args) => args.includes("busybox:latest"))).toBe(false);
  });
});
