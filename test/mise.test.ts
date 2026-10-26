import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MiseInteractProvider } from "../src/providers/mise/main.ts";
import { getBackend, resolveDownloadUrl, searchRegistry } from "../src/providers/mise/registry.ts";
import {
  createTestContext,
  FakeExec,
  FakeHttp,
  jsonResponse,
  silentLogger,
  textResponse,
} from "./helpers.ts";

const dirs: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hi-mise-"));
  dirs.push(dir);
  return dir;
}

const TOML = `
description = "Demo tool"
backends = ["aqua:owner/repo"]
`;

const YAML = `
packages:
  - type: github_release
    asset: "demo_{{trimV .Version}}_{{.OS}}_{{.Arch}}.{{.Format}}"
    format: tar.gz
    replacements:
      linux: Linux
      amd64: x86_64
    version_overrides:
      - version_constraint: "true"
        asset: "demo_{{trimV .Version}}_{{.OS}}_{{.Arch}}.{{.Format}}"
`;

function registryHttp(overrides: { assetTar?: Uint8Array; tags?: boolean } = {}): FakeHttp {
  return new FakeHttp((url) => {
    if (url.endsWith("/registry/demo.toml")) return textResponse(TOML);
    if (url.includes("/pkgs/owner/repo/registry.yaml")) return textResponse(YAML);
    if (url.includes("github.com/owner/repo/releases/download/")) {
      return new Response(overrides.assetTar ?? new Uint8Array(), {
        status: 200,
        headers: {
          "content-length": String((overrides.assetTar ?? new Uint8Array()).length),
        },
      });
    }
    if (url.endsWith("/repos/owner/repo/releases")) {
      return jsonResponse([
        { tag_name: "v1.2.3", draft: false, prerelease: false },
        { tag_name: "v1.2.2", draft: false, prerelease: false },
      ]);
    }
    if (url.endsWith("/repos/owner/repo/tags")) {
      return jsonResponse([{ name: "v1.2.3" }, { name: "v1.2.2" }]);
    }
    if (url.includes("git/trees/main")) {
      return jsonResponse({
        tree: [
          { path: "registry/demo.toml" },
          { path: "registry/terraform.toml" },
          { path: "registry/tarraform.toml" },
          { path: "registry/README.md" },
        ],
      });
    }
    return jsonResponse({ message: `unexpected ${url}` }, 404);
  });
}

function deps(http: FakeHttp) {
  return { http, logger: silentLogger(), githubToken: "" };
}

describe("mise registry", () => {
  test("reads the aqua backend from TOML", async () => {
    const backend = await getBackend(deps(registryHttp()), "demo");
    expect(backend).toEqual({
      owner: "owner",
      repo: "repo",
      aquaPath: "owner/repo",
      description: "Demo tool",
      versionSource: "github_release",
    });
  });

  test("resolves github_release URLs with replacements", async () => {
    const asset = await resolveDownloadUrl(deps(registryHttp()), "demo", "v1.2.3", {
      osName: "linux",
      arch: "amd64",
    });
    expect(asset?.url).toBe(
      "https://github.com/owner/repo/releases/download/v1.2.3/demo_1.2.3_Linux_x86_64.tar.gz",
    );
    expect(asset?.name).toBe("demo_1.2.3_Linux_x86_64.tar.gz");
    expect(asset?.version).toBe("v1.2.3");
  });

  test("supports http package templates", async () => {
    const http = new FakeHttp((url) => {
      if (url.endsWith("/registry/demo.toml")) return textResponse(TOML);
      if (url.includes("/pkgs/owner/repo/registry.yaml")) {
        return textResponse(`
packages:
  - type: http
    url: "https://example.com/{{.Version}}/demo-{{.OS}}-{{.Arch}}.{{.Format}}"
    format: zip
`);
      }
      return jsonResponse({}, 404);
    });
    const asset = await resolveDownloadUrl(deps(http), "demo", "v1.0.0", {
      osName: "linux",
      arch: "amd64",
    });
    expect(asset?.url).toBe("https://example.com/v1.0.0/demo-linux-amd64.zip");
  });

  test("fuzzy-searches registry names", async () => {
    const names = await searchRegistry(deps(registryHttp()), "tarraform");
    expect(names).toContain("terraform");
    expect(names).not.toContain("tarraform");
    expect(names).not.toContain("demo");
  });
});

describe("mise provider", () => {
  test("installs a tool end-to-end from the registry", async () => {
    const dir = await tempDir();
    const tarPath = join(dir, "asset.tar.gz");
    const toolPath = join(dir, "demo");
    await writeFile(
      toolPath,
      new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x0a]),
      { mode: 0o755 },
    );
    await chmod(toolPath, 0o755);
    // Build a tar.gz containing an ELF binary.
    const tar = new Bun.Archive({ demo: new Uint8Array(await Bun.file(toolPath).arrayBuffer()) });
    await Bun.write(join(dir, "asset.tar"), tar);
    const tarBytes = new Uint8Array(await Bun.file(join(dir, "asset.tar")).arrayBuffer());
    const gz = Bun.gzipSync(tarBytes);
    await writeFile(tarPath, gz);

    const http = registryHttp({ assetTar: gz });
    const { ctx, root, cleanup } = await createTestContext({ http, exec: new FakeExec() });
    cleanups.push(cleanup);

    await new MiseInteractProvider("demo", ctx).get({ prompt: false });

    const tool = ctx.state.get("demo");
    expect(tool?.provider).toBe("mise");
    expect(tool?.source).toBe("mise@demo");
    expect(tool?.tagName).toBe("v1.2.3");
    expect(await readFile(join(root, "bin", "demo"))).toBeDefined();
  });
});
