import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { download } from "../src/download.ts";
import { HttpError } from "../src/http.ts";
import { FakeHttp, silentLogger } from "./helpers.ts";

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
