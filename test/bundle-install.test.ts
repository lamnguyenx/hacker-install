import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { remove } from "../src/app/manage.ts";
import { installBin } from "../src/helper/install.ts";
import { createTestContext, FakeExec, sampleTool, silentLogger, writeElf } from "./helpers.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function writeBundle(root: string, version: string, name = "code-server"): Promise<string> {
  const packageDir = join(root, `${name}-${version}-macos-arm64`);
  await mkdir(join(packageDir, "bin"), { recursive: true });
  await mkdir(join(packageDir, "lib"), { recursive: true });
  const launcher = join(packageDir, "bin", name);
  await writeFile(launcher, `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
  await writeFile(join(packageDir, "lib", "node"), `runtime ${version}`);
  return packageDir;
}

describe("bundle installation", () => {
  test("keeps the tree and symlinks the launcher", async () => {
    const { root, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    const src = join(root, "src");
    const dest = join(root, "bin");
    const bundles = join(root, "bundles");
    await writeBundle(src, "1.0.0");

    expect(
      await installBin(src, dest, {
        local: true,
        name: "code-server",
        bundleRoot: bundles,
        exec: new FakeExec(),
        logger: silentLogger(),
      }),
    ).toBe(true);

    const link = join(dest, "code-server");
    const versionDir = join(bundles, "code-server", "code-server-1.0.0-macos-arm64");
    const installed = join(versionDir, "bin", "code-server");
    expect((await import("node:fs/promises")).lstat(link)).resolves.toBeDefined();
    expect(await readFile(installed, "utf8")).toContain("1.0.0");
    expect(await readFile(join(versionDir, "lib", "node"), "utf8")).toBe("runtime 1.0.0");
  });

  test("handles a bundle at the archive root", async () => {
    const { root, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    const src = join(root, "src");
    await mkdir(join(src, "bin"), { recursive: true });
    await writeFile(join(src, "bin", "mytool"), "#!/bin/sh\necho hi\n", { mode: 0o755 });
    const dest = join(root, "bin");
    const bundles = join(root, "bundles");

    expect(
      await installBin(src, dest, {
        local: true,
        name: "mytool",
        version: "v1.0.0",
        bundleRoot: bundles,
        exec: new FakeExec(),
        logger: silentLogger(),
      }),
    ).toBe(true);

    expect(await readFile(join(bundles, "mytool", "v1.0.0", "bin", "mytool"), "utf8")).toContain(
      "hi",
    );
  });

  test("appends the release tag when the extracted folder has no version", async () => {
    const { root, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    const src = join(root, "src");
    const packageDir = join(src, "code-server-linux-amd64");
    await mkdir(join(packageDir, "bin"), { recursive: true });
    await writeFile(join(packageDir, "bin", "code-server"), "#!/bin/sh\necho hi\n", {
      mode: 0o755,
    });
    const dest = join(root, "bin");
    const bundles = join(root, "bundles");

    expect(
      await installBin(src, dest, {
        local: true,
        name: "code-server",
        version: "v4.143.1",
        bundleRoot: bundles,
        exec: new FakeExec(),
        logger: silentLogger(),
      }),
    ).toBe(true);

    const installed = join(
      bundles,
      "code-server",
      "code-server-linux-amd64-v4.143.1",
      "bin",
      "code-server",
    );
    expect(await readFile(installed, "utf8")).toContain("hi");
  });

  test("installs a single binary flat", async () => {
    const { root, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    const src = join(root, "src");
    await mkdir(src, { recursive: true });
    await writeElf(join(src, "mytool"));
    const dest = join(root, "bin");
    const bundles = join(root, "bundles");

    expect(
      await installBin(src, dest, {
        local: true,
        name: "mytool",
        bundleRoot: bundles,
        exec: new FakeExec(),
        logger: silentLogger(),
      }),
    ).toBe(true);

    expect(await readFile(join(dest, "mytool"))).toBeDefined();
    expect(
      await import("node:fs/promises").then(({ lstat }) => lstat(join(dest, "mytool"))),
    ).toBeDefined();
    await expect(
      import("node:fs/promises").then(({ stat }) => stat(join(bundles, "mytool"))),
    ).rejects.toThrow();
  });

  test("upgrading replaces the bundle tree", async () => {
    const { root, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    const dest = join(root, "bin");
    const bundles = join(root, "bundles");
    const v1 = join(root, "v1");
    const v2 = join(root, "v2");
    await writeBundle(v1, "1.0.0");
    await writeBundle(v2, "2.0.0");

    const options = {
      local: true,
      name: "code-server",
      bundleRoot: bundles,
      exec: new FakeExec(),
      logger: silentLogger(),
    };
    expect(await installBin(v1, dest, { ...options, version: "v1.0.0" })).toBe(true);
    expect(await installBin(v2, dest, { ...options, version: "v2.0.0" })).toBe(true);

    expect(
      await readFile(
        join(bundles, "code-server", "code-server-2.0.0-macos-arm64", "bin", "code-server"),
        "utf8",
      ),
    ).toContain("2.0.0");
    await expect(
      import("node:fs/promises").then(({ stat }) =>
        stat(join(bundles, "code-server", "code-server-1.0.0-macos-arm64")),
      ),
    ).rejects.toThrow();
  });

  test("remove deletes the bundle and symlink", async () => {
    const { ctx, root, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    const src = join(root, "src");
    const dest = join(root, "bin");
    const bundles = join(root, "bundles");
    await writeBundle(src, "1.0.0");
    await installBin(src, dest, {
      local: true,
      name: "code-server",
      bundleRoot: bundles,
      exec: new FakeExec(),
      logger: silentLogger(),
    });

    ctx.state.set(
      sampleTool({
        name: "code-server",
        source: "https://github.com/coder/code-server",
      }),
    );
    ctx.state.set({ ...sampleTool({ name: "code-server" }), installMethod: "binary" });
    await remove(ctx, "code-server");

    await expect(
      import("node:fs/promises").then(({ stat }) => stat(join(dest, "code-server"))),
    ).rejects.toThrow();
    await expect(
      import("node:fs/promises").then(({ stat }) => stat(join(bundles, "code-server"))),
    ).rejects.toThrow();
  });

  test("remove handles a symlinked bundle root", async () => {
    const { ctx, root, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    const src = join(root, "src");
    const dest = join(root, "bin");
    const realBundles = join(root, "real-bundles");
    const bundles = join(root, "bundles");
    await mkdir(realBundles, { recursive: true });
    await symlink(realBundles, bundles, "dir");
    await writeBundle(src, "1.0.0");
    await installBin(src, dest, {
      local: true,
      name: "code-server",
      bundleRoot: bundles,
      exec: new FakeExec(),
      logger: silentLogger(),
    });
    ctx.config.bundlePath = bundles;
    ctx.state.set(sampleTool({ name: "code-server" }));
    await ctx.state.save();

    await remove(ctx, "code-server");

    await expect(
      import("node:fs/promises").then(({ stat }) => stat(join(realBundles, "code-server"))),
    ).rejects.toThrow();
  });
});
