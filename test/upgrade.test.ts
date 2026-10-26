import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upgrade } from "../src/app/upgrade.ts";
import { hostToken } from "../src/providers/git/main.ts";
import {
  createTestContext,
  FakeExec,
  FakeHttp,
  FakeIO,
  jsonResponse,
  sampleTool,
  textResponse,
} from "./helpers.ts";

const dirs: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hi-upgrade-"));
  dirs.push(dir);
  return dir;
}

describe("upgrade package notification", () => {
  test("reports packages without installing them", async () => {
    const io = new FakeIO(["n"]);
    const http = new FakeHttp((url) => {
      if (url === "https://api.github.com/repos/o/r") {
        return jsonResponse({ name: "r", full_name: "o/r" });
      }
      if (url === "https://api.github.com/repos/o/r/releases/latest") {
        return jsonResponse({
          tag_name: "v2.0.0",
          prerelease: false,
          published_at: "2026-02-01T00:00:00Z",
          assets: [
            {
              name: "tool.deb",
              browser_download_url: "https://example.com/tool.deb",
              size: 1,
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    const { ctx, cleanup } = await createTestContext({ io, http });
    cleanups.push(cleanup);
    ctx.state.set(
      sampleTool({
        name: "tool",
        source: "https://github.com/o/r",
        tagName: "v1.0.0",
        publishedAt: "2026-01-01T00:00:00Z",
        installMethod: "package",
        packageType: "deb",
      }),
    );
    await ctx.state.save();

    await upgrade(ctx, { skipPrompt: false });
    expect(io.output()).toContain("Following package can be upgraded");
    expect(io.output()).toContain("All tools are onto latest version");
  });
});

describe("mise upgrade", () => {
  test("installs the newer version", async () => {
    const dir = await tempDir();
    const tool = join(dir, "demo");
    await writeFile(tool, new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x0a]), {
      mode: 0o755,
    });
    await chmod(tool, 0o755);
    const tar = new Bun.Archive({ demo: new Uint8Array(await Bun.file(tool).arrayBuffer()) });
    await Bun.write(join(dir, "asset.tar"), tar);
    const gz = Bun.gzipSync(new Uint8Array(await Bun.file(join(dir, "asset.tar")).arrayBuffer()));

    const http = new FakeHttp((url) => {
      if (url.endsWith("/registry/demo.toml")) {
        return textResponse('description = "Demo"\nbackends = ["aqua:owner/repo"]\n');
      }
      if (url.includes("/pkgs/owner/repo/registry.yaml")) {
        return textResponse(`
packages:
  - type: github_release
    asset: "demo_{{trimV .Version}}_{{.OS}}_{{.Arch}}.{{.Format}}"
    format: tar.gz
`);
      }
      if (url.endsWith("/repos/owner/repo/releases")) {
        return jsonResponse([{ tag_name: "v1.2.3", draft: false, prerelease: false }]);
      }
      if (url.includes("github.com/owner/repo/releases/download/")) {
        return new Response(gz, {
          status: 200,
          headers: { "content-length": String(gz.length) },
        });
      }
      return jsonResponse({}, 404);
    });

    const { ctx, root, cleanup } = await createTestContext({
      http,
      exec: new FakeExec(),
    });
    cleanups.push(cleanup);
    ctx.state.set(
      sampleTool({
        name: "demo",
        provider: "mise",
        source: "mise@demo",
        tagName: "v1.0.0",
        publishedAt: "2026-01-01T00:00:00Z",
      }),
    );
    await ctx.state.save();

    await upgrade(ctx, { skipPrompt: true });
    expect(ctx.state.get("demo")?.tagName).toBe("v1.2.3");
    expect(await Bun.file(join(root, "bin", "demo")).exists()).toBe(true);
  });
});

describe("host token registration", () => {
  test("registers unseen hosts and saves config", async () => {
    const { ctx, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    const tokens = ctx.config.tokens.gitlab;
    expect(await hostToken(ctx, tokens, "gitlab.example.com")).toBe("");
    expect(tokens["gitlab.example.com"]).toBe("");
    expect(ctx.config.tokens.gitlab["gitlab.example.com"]).toBe("");
  });
});
