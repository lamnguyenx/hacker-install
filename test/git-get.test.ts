import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitInteractProvider, getRepoInfo } from "../src/providers/git/main.ts";
import {
  createTestContext,
  FakeExec,
  FakeHttp,
  jsonResponse,
  writeElf,
  writeTarGz,
} from "./helpers.ts";

const dirs: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hi-git-get-"));
  dirs.push(dir);
  return dir;
}

async function binaryTarGz(): Promise<Uint8Array> {
  const dir = await tempDir();
  const tool = join(dir, "tool");
  await writeElf(tool);
  const tar = join(dir, "tool.tar.gz");
  await writeTarGz(tar, { tool: await readFile(tool, "utf8").catch(() => "") });
  // writeTarGz writes text; rebuild with raw bytes so the ELF magic survives.
  const template = new Bun.Archive(
    { tool: new Uint8Array(await Bun.file(tool).arrayBuffer()) },
    {
      compress: "gzip",
    },
  );
  await Bun.write(tar, template);
  return new Uint8Array(await Bun.file(tar).arrayBuffer());
}

async function gitHubHttp(
  assetName: string,
  assetBytes: Uint8Array,
  extraAssets: Array<{ name: string; url: string }> = [],
): Promise<FakeHttp> {
  return new FakeHttp((url) => {
    if (url === "https://api.github.com/repos/o/r") {
      return jsonResponse({
        name: "r",
        full_name: "o/r",
        description: "demo",
        language: "Go",
        stargazers_count: 10,
      });
    }
    if (url === "https://api.github.com/repos/o/r/releases/latest") {
      return jsonResponse({
        tag_name: "v1.0.0",
        prerelease: false,
        published_at: "2026-01-01T00:00:00Z",
        assets: [
          {
            browser_download_url: `https://example.com/${assetName}`,
            content_type: "application/gzip",
            created_at: "2026-01-01T00:00:00Z",
            download_count: 2,
            id: 1,
            name: assetName,
            node_id: "",
            size: assetBytes.length,
            state: "uploaded",
            updated_at: "2026-01-01T00:00:00Z",
          },
          ...extraAssets.map((asset, index) => ({
            browser_download_url: asset.url,
            content_type: "",
            created_at: "",
            download_count: 0,
            id: index + 2,
            name: asset.name,
            node_id: "",
            size: 1,
            state: "",
            updated_at: "",
          })),
        ],
      });
    }
    if (url === `https://example.com/${assetName}`) {
      return new Response(assetBytes, {
        status: 200,
        headers: { "content-length": String(assetBytes.length) },
      });
    }
    return jsonResponse({ message: `unexpected ${url}` }, 404);
  });
}

describe("GitHub get flow", () => {
  test("downloads, extracts and installs a binary", async () => {
    const bytes = await binaryTarGz();
    const http = await gitHubHttp("tool-linux-x86_64.tar.gz", bytes);
    const { ctx, root, cleanup } = await createTestContext({ http, exec: new FakeExec() });
    cleanups.push(cleanup);

    const repo = await getRepoInfo(ctx, "https://github.com/o/r");
    await new GitInteractProvider(repo, ctx).get({
      prompt: false,
      name: "tool",
    });

    const tool = ctx.state.get("tool");
    expect(tool?.provider).toBe("github");
    expect(tool?.source).toBe("https://github.com/o/r");
    expect(tool?.tagName).toBe("v1.0.0");
    expect(tool?.installMethod).toBe("binary");
    expect(await readFile(join(root, "bin", "tool"))).toBeDefined();
  });

  test("supports --file exact asset matching", async () => {
    const bytes = await binaryTarGz();
    const http = await gitHubHttp("tool-linux-x86_64.tar.gz", bytes, [
      { name: "tool-darwin-arm64.tar.gz", url: "https://example.com/tool-darwin" },
    ]);
    const { ctx, root, cleanup } = await createTestContext({ http, exec: new FakeExec() });
    cleanups.push(cleanup);

    const repo = await getRepoInfo(ctx, "https://github.com/o/r");
    await new GitInteractProvider(repo, ctx).get({
      prompt: false,
      name: "tool",
      assetFile: "tool-linux-x86_64.tar.gz",
    });

    expect(ctx.state.get("tool")?.customReleaseWords).toEqual(["tool", "linux", "x", "tar"]);
    expect(await readFile(join(root, "bin", "tool"))).toBeDefined();
  });

  test("installs a deb package in --pkg mode", async () => {
    const dir = await tempDir();
    const deb = new Uint8Array([0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e]);
    const http = await gitHubHttp("tool-linux-x86_64.deb", deb);
    const exec = new FakeExec((args) => {
      if (args[0] === "dpkg-deb") return { stdout: "mytool\n" };
      if (args[0] === "sudo" && args[1] === "dpkg") return { code: 0 };
      return { code: 0 };
    });
    const { ctx, root, cleanup } = await createTestContext({
      http,
      exec,
      osPackageType: "deb",
    });
    cleanups.push(cleanup);
    await chmod(dir, 0o700);

    const repo = await getRepoInfo(ctx, "https://github.com/o/r");
    await new GitInteractProvider(repo, ctx, true).get({
      prompt: false,
      name: "tool",
    });

    const tool = ctx.state.get("tool");
    expect(tool?.installMethod).toBe("package");
    expect(tool?.packageType).toBe("deb");
    expect(tool?.packageName).toBe("mytool");
    expect(exec.calls.some((args) => args[0] === "dpkg-deb")).toBe(true);
    expect(await readFile(join(root, "bin", "tool")).catch(() => null)).toBeNull();
  });
});
