import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract, extractUrl } from "../src/extract.ts";
import {
  detectFileKindFromPath,
  hasNodeShebang,
  isExecutableFile,
  isInstallCandidate,
} from "../src/filetype.ts";
import {
  FakeExec,
  FakeHttp,
  silentLogger,
  textResponse,
  writeElf,
  writeTarGz,
  writeZip,
} from "./helpers.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hi-extract-"));
  dirs.push(dir);
  return dir;
}

describe("filetype detection", () => {
  test("detects native executables and archives", async () => {
    const dir = await tempDir();
    await writeElf(join(dir, "tool"));
    await writeFile(join(dir, "tool.gz"), Bun.gzipSync(new TextEncoder().encode("hi")));
    await writeFile(join(dir, "tool.zip"), new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    await writeFile(join(dir, "tool.zst"), Bun.zstdCompressSync(new TextEncoder().encode("hi")));
    await writeFile(join(dir, "tool.xz"), new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]));
    await writeFile(join(dir, "tool.bz2"), new Uint8Array([0x42, 0x5a, 0x68]));

    expect(await detectFileKindFromPath(join(dir, "tool"))).toBe("elf");
    expect(await detectFileKindFromPath(join(dir, "tool.gz"))).toBe("gzip");
    expect(await detectFileKindFromPath(join(dir, "tool.zip"))).toBe("zip");
    expect(await detectFileKindFromPath(join(dir, "tool.zst"))).toBe("zstd");
    expect(await detectFileKindFromPath(join(dir, "tool.xz"))).toBe("xz");
    expect(await detectFileKindFromPath(join(dir, "tool.bz2"))).toBe("bzip2");
  });

  test("detects Mach-O and PE headers", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "mac"), new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
    await writeFile(join(dir, "win"), new Uint8Array([0x4d, 0x5a, 0, 0]));
    expect(await detectFileKindFromPath(join(dir, "mac"))).toBe("macho");
    expect(await detectFileKindFromPath(join(dir, "win"))).toBe("pe");
  });

  test("skips shared libraries in install candidates", async () => {
    const dir = await tempDir();
    await writeElf(join(dir, "libfoo.so.1"));
    await writeElf(join(dir, "libfoo.dylib"));
    expect(await isInstallCandidate(join(dir, "libfoo.so.1"))).toBe(false);
    expect(await isInstallCandidate(join(dir, "libfoo.dylib"))).toBe(false);
  });

  test("requires a node shebang for JS install candidates", async () => {
    const dir = await tempDir();
    const good = join(dir, "good.js");
    const bad = join(dir, "bad.js");
    await writeFile(good, "#!/usr/bin/env node\nconsole.log('hi')\n", { mode: 0o755 });
    await writeFile(bad, "console.log('hi')\n", { mode: 0o755 });
    expect(hasNodeShebang(await Bun.file(good).bytes())).toBe(true);
    expect(await isInstallCandidate(good)).toBe(true);
    expect(await isInstallCandidate(bad)).toBe(false);
    expect(await isExecutableFile(good)).toBe(true);
  });
});

describe("archive extraction", () => {
  test("extracts tar.gz", async () => {
    const dir = await tempDir();
    const archive = join(dir, "tool.tar.gz");
    const out = join(dir, "out");
    await writeTarGz(archive, { tool: "#!/bin/sh\n", "lib/data": "runtime" });

    await extract(archive, out, { exec: new FakeExec(), logger: silentLogger() });

    expect(await readFile(join(out, "tool"), "utf8")).toBe("#!/bin/sh\n");
    expect(await readFile(join(out, "lib/data"), "utf8")).toBe("runtime");
  });

  test("extracts zip", async () => {
    const dir = await tempDir();
    const archive = join(dir, "tool.zip");
    const out = join(dir, "out");
    await writeZip(archive, { "bin/tool": "#!/bin/sh\n", "README.md": "hi" });

    await extract(archive, out, { exec: new FakeExec(), logger: silentLogger() });

    expect(await readFile(join(out, "bin/tool"), "utf8")).toBe("#!/bin/sh\n");
    expect(await readFile(join(out, "README.md"), "utf8")).toBe("hi");
  });

  test("extracts tar.zst", async () => {
    const dir = await tempDir();
    const tarPath = join(dir, "tool.tar");
    await Bun.write(tarPath, new Bun.Archive({ tool: "content" }));
    const tarBytes = new Uint8Array(await Bun.file(tarPath).arrayBuffer());
    const archive = join(dir, "tool.tar.zst");
    await writeFile(archive, Bun.zstdCompressSync(tarBytes));
    const out = join(dir, "out");

    await extract(archive, out, { exec: new FakeExec(), logger: silentLogger() });

    expect(await readFile(join(out, "tool"), "utf8")).toBe("content");
  });

  test("extracts a single gzip file", async () => {
    const dir = await tempDir();
    const archive = join(dir, "tool.gz");
    await writeFile(archive, Bun.gzipSync(new TextEncoder().encode("hello")));
    const out = join(dir, "out");

    await extract(archive, out, { exec: new FakeExec(), logger: silentLogger() });

    expect(await readFile(join(out, "tool"), "utf8")).toBe("hello");
  });

  test("rejects zip path traversal", async () => {
    const dir = await tempDir();
    const archive = join(dir, "evil.zip");
    const out = join(dir, "out");
    await writeZip(archive, { "../escape": "bad" });
    await expect(
      extract(archive, out, { exec: new FakeExec(), logger: silentLogger() }),
    ).rejects.toThrow();
  });

  test("extractUrl skips extraction for a raw binary", async () => {
    const dir = await tempDir();
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3, 4]);
    const http = new FakeHttp(() => textResponse(new TextDecoder().decode(elf)));

    // textResponse cannot carry arbitrary bytes; use a raw Response.
    const binaryHttp = new FakeHttp(
      () => new Response(elf, { status: 200, headers: { "content-length": String(elf.length) } }),
    );
    expect(http).toBeTruthy();

    await extractUrl("https://example.com/tool", dir, {
      http: binaryHttp,
      exec: new FakeExec(),
      logger: silentLogger(),
      progress: false,
    });

    expect(await detectFileKindFromPath(join(dir, "tool"))).toBe("elf");
  });
});
