import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { download } from "../src/download.ts";
import { HttpError } from "../src/http.ts";
import { FakeExec, FakeHttp, silentLogger } from "./helpers.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hi-download-"));
  dirs.push(dir);
  return dir;
}

function streamResponse(
  chunks: Uint8Array[],
  options: { status?: number; contentLength?: number; failAfter?: number } = {},
): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (options.failAfter !== undefined && index === options.failAfter) {
        controller.error(new Error("connection reset"));
        return;
      }
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index] as Uint8Array);
      index += 1;
    },
  });
  return new Response(stream, {
    status: options.status ?? 200,
    headers: {
      ...(options.contentLength !== undefined
        ? { "content-length": String(options.contentLength) }
        : {}),
    },
  });
}

describe("download", () => {
  test("streams to disk and uses no overall timeout", async () => {
    const dir = await tempDir();
    const http = new FakeHttp(() =>
      streamResponse([new TextEncoder().encode("ab"), new TextEncoder().encode("cdef")], {
        contentLength: 6,
      }),
    );

    const output = await download("https://example.com/tool.tar.gz", dir, {
      http,
      logger: silentLogger(),
      progress: false,
    });

    expect(output).toBe(join(dir, "tool.tar.gz"));
    expect(await readFile(output, "utf8")).toBe("abcdef");
    expect(http.requests[0]?.options.timeoutMs).toBe(0);
    expect(http.requests[0]?.options.headers?.Range).toBeUndefined();
  });

  test("resumes with a Range header after a broken stream", async () => {
    const dir = await tempDir();
    const output = join(dir, "tool.bin");

    let attempt = 0;
    const http = new FakeHttp((_url, options) => {
      attempt += 1;
      if (attempt === 1) {
        expect(options.headers?.Range).toBeUndefined();
        return streamResponse([new TextEncoder().encode("ab"), new TextEncoder().encode("cd")], {
          status: 200,
          contentLength: 6,
          failAfter: 1,
        });
      }
      expect(options.headers?.Range).toBe("bytes=2-");
      return streamResponse([new TextEncoder().encode("cdef")], {
        status: 206,
        contentLength: 4,
      });
    });

    await download("https://example.com/tool.bin", dir, {
      http,
      logger: silentLogger(),
      progress: false,
      maxRetries: 3,
      retryDelayMs: 0,
    });

    expect(http.requests).toHaveLength(2);
    expect(await readFile(output, "utf8")).toBe("abcdef");
  });

  test("restarts when the server ignores Range", async () => {
    const dir = await tempDir();
    const output = join(dir, "tool.bin");
    await writeFile(output, "old");

    const http = new FakeHttp((_url, options) => {
      expect(options.headers?.Range).toBe("bytes=3-");
      return streamResponse([new TextEncoder().encode("fresh")], {
        status: 200,
        contentLength: 5,
      });
    });

    await download("https://example.com/tool.bin", dir, {
      http,
      logger: silentLogger(),
      progress: false,
    });

    expect(await readFile(output, "utf8")).toBe("fresh");
    expect(http.requests).toHaveLength(1);
  });

  test("does not retry HTTP errors", async () => {
    const dir = await tempDir();
    const http = new FakeHttp(() => new Response("nope", { status: 404 }));

    await expect(
      download("https://example.com/missing", dir, {
        http,
        logger: silentLogger(),
        progress: false,
      }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(http.requests).toHaveLength(1);
  });
});

describe("aria2c downloader", () => {
  const ARIA2_VERSION = "aria2 version 1.37.0\nCopyright (C) 2006, 2019 Tatsuhiro Tsujikawa";

  function aria2Exec(
    onDownload: (args: string[]) => { code?: number } | Promise<{ code?: number }> = () => ({}),
  ): FakeExec {
    return new FakeExec(async (args) => {
      if (args.includes("--version")) return { code: 0, stdout: ARIA2_VERSION };
      return onDownload(args);
    });
  }

  function flag(args: string[], name: string): string | undefined {
    const prefix = `--${name}=`;
    return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  }

  test("uses aria2c with 8 connections, resume flags and a quiet console", async () => {
    const dir = await tempDir();
    const http = new FakeHttp(() => streamResponse([], { contentLength: 4 }));
    const exec = aria2Exec(async (args) => {
      const out = flag(args, "out") as string;
      const at = flag(args, "dir") as string;
      await writeFile(join(at, out), "abcd");
      return { code: 0 };
    });

    const output = await download("https://example.com/tool.bin", dir, {
      http,
      exec,
      logger: silentLogger(),
      progress: false,
    });

    expect(await readFile(output, "utf8")).toBe("abcd");
    const call = exec.calls.find((args) => args[0] === "aria2c" && !args.includes("--version"));
    expect(call).toBeDefined();
    expect(call).toContain("--continue=true");
    expect(call).toContain("--allow-overwrite=true");
    expect(call).toContain("--auto-file-renaming=false");
    expect(call).toContain("--max-connection-per-server=8");
    expect(call).toContain("--split=8");
    expect(call).toContain("--user-agent=hacker-install");
    expect(call).toContain("--summary-interval=0");
    // The body is never streamed through the HTTP client: only the size probe.
    expect(http.requests).toHaveLength(1);
  });

  test("honors a custom connection count", async () => {
    const dir = await tempDir();
    const http = new FakeHttp(() => streamResponse([], { contentLength: 1 }));
    const exec = aria2Exec(async (args) => {
      await writeFile(join(flag(args, "dir") as string, flag(args, "out") as string), "a");
      return { code: 0 };
    });

    await download("https://example.com/tool.bin", dir, {
      http,
      exec,
      connections: 12,
      logger: silentLogger(),
      progress: false,
    });

    const call = exec.calls.find((args) => args[0] === "aria2c" && !args.includes("--version"));
    expect(call).toContain("--max-connection-per-server=12");
    expect(call).toContain("--split=12");
  });

  test("falls back to the built-in downloader when aria2c fails", async () => {
    const dir = await tempDir();
    let bodyRequests = 0;
    const http = new FakeHttp((_url, options) => {
      if (options.signal) return streamResponse([], { contentLength: 4 });
      bodyRequests += 1;
      return streamResponse([new TextEncoder().encode("abcd")], { contentLength: 4 });
    });
    const exec = aria2Exec(() => ({ code: 1 }));

    const output = await download("https://example.com/tool.bin", dir, {
      http,
      exec,
      logger: silentLogger(),
      progress: false,
    });

    expect(await readFile(output, "utf8")).toBe("abcd");
    expect(bodyRequests).toBe(1);
  });

  test("resumes from bytes aria2c already wrote", async () => {
    const dir = await tempDir();
    const output = join(dir, "tool.bin");
    const http = new FakeHttp((_url, options) => {
      if (options.signal) return streamResponse([], { contentLength: 4 });
      expect(options.headers?.Range).toBe("bytes=2-");
      return streamResponse([new TextEncoder().encode("cd")], { status: 206, contentLength: 2 });
    });
    const exec = aria2Exec(async (args) => {
      await writeFile(join(flag(args, "dir") as string, flag(args, "out") as string), "ab");
      return { code: 0 };
    });

    await download("https://example.com/tool.bin", dir, {
      http,
      exec,
      logger: silentLogger(),
      progress: false,
    });

    expect(await readFile(output, "utf8")).toBe("abcd");
  });

  test("ignores a binary that only pretends to be aria2c", async () => {
    const dir = await tempDir();
    const http = new FakeHttp(() =>
      streamResponse([new TextEncoder().encode("real")], { contentLength: 4 }),
    );
    const exec = new FakeExec();

    await download("https://example.com/tool.bin", dir, {
      http,
      exec,
      logger: silentLogger(),
      progress: false,
    });

    expect(
      exec.calls.filter((args) => args[0] === "aria2c" && !args.includes("--version")),
    ).toHaveLength(0);
    expect(http.requests).toHaveLength(1);
  });
});
