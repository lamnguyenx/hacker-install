import { afterEach, describe, expect, test } from "bun:test";
import { completionScript, detectShell } from "../src/app/completion.ts";
import { findCompletionFlag, parseInlineTag, runCli } from "../src/cli.ts";
import { createTestContext, FakeIO } from "./helpers.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("get URL parsing", () => {
  test("splits mise inline versions", () => {
    expect(parseInlineTag("mise@terraform:v1.12.0", "")).toEqual({
      url: "mise@terraform",
      tag: "v1.12.0",
    });
    expect(parseInlineTag("mise@terraform", "")).toEqual({
      url: "mise@terraform",
      tag: "",
    });
  });

  test("splits docker tags but not registry ports", () => {
    expect(parseInlineTag("docker@alpine:3.19", "")).toEqual({
      url: "docker@alpine",
      tag: "3.19",
    });
    expect(parseInlineTag("docker@registry:5000/foo", "")).toEqual({
      url: "docker@registry:5000/foo",
      tag: "",
    });
    expect(parseInlineTag("docker@registry:5000/foo:1.0", "")).toEqual({
      url: "docker@registry:5000/foo",
      tag: "1.0",
    });
  });

  test("rejects unsafe custom names", async () => {
    const { ctx, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    const { get } = await import("../src/app/get.ts");
    await expect(
      get(ctx, { url: "https://github.com/o/r", name: "../escape", prompt: false }),
    ).rejects.toThrow("Invalid tool name");
  });

  test("explicit --tag wins", () => {
    expect(parseInlineTag("docker@alpine:3.19", "latest")).toEqual({
      url: "docker@alpine:3.19",
      tag: "latest",
    });
  });

  test("plain repository URLs are untouched", () => {
    expect(parseInlineTag("https://github.com/o/r", "")).toEqual({
      url: "https://github.com/o/r",
      tag: "",
    });
  });
});

describe("completion flags", () => {
  test("finds install/show completion", () => {
    expect(findCompletionFlag(["--show-completion", "zsh"])).toEqual({
      mode: "show",
      shell: "zsh",
    });
    expect(findCompletionFlag(["--install-completion=bash"])).toEqual({
      mode: "install",
      shell: "bash",
    });
    expect(findCompletionFlag(["ls"])).toBeNull();
  });

  test("generates scripts for every shell", () => {
    for (const shell of ["bash", "zsh", "fish", "powershell"] as const) {
      const script = completionScript(shell);
      expect(script).toContain("get");
      expect(script).toContain("upgrade");
    }
  });

  test("detects the current shell", () => {
    expect(detectShell({ SHELL: "/bin/zsh" })).toBe("zsh");
    expect(detectShell({ SHELL: "/usr/bin/fish" })).toBe("fish");
    expect(detectShell({ SHELL: "" })).toBe("bash");
  });
});

describe("CLI wiring", () => {
  test("--version and me --version print the package version", async () => {
    const io = new FakeIO();
    const { ctx, cleanup } = await createTestContext({ io });
    cleanups.push(cleanup);

    expect(await runCli(["node", "hi", "--version"], ctx, { exitOverride: true })).toBe(0);
    expect(io.prints).toEqual([ctx.version]);
  });

  test("me --version prints the package version", async () => {
    const io = new FakeIO();
    const { ctx, cleanup } = await createTestContext({ io });
    cleanups.push(cleanup);

    const code = await runCli(["node", "hi", "me", "--version"], ctx, {
      exitOverride: true,
    });
    expect(code).toBe(0);
    expect(io.prints).toEqual([ctx.version]);
  });

  test("ls --json writes JSON", async () => {
    const io = new FakeIO();
    const { ctx, cleanup } = await createTestContext({ io });
    cleanups.push(cleanup);

    const code = await runCli(["node", "hi", "ls", "--json"], ctx, {
      exitOverride: true,
    });
    expect(code).toBe(0);
    expect(JSON.parse(io.prints[0] ?? "null")).toEqual([]);
  });

  test("config --pre-release toggles and --no-pre-release clears", async () => {
    const { ctx, cleanup } = await createTestContext();
    cleanups.push(cleanup);

    await runCli(["node", "hi", "config", "--pre-release"], ctx, {
      exitOverride: true,
    });
    expect(ctx.config.preRelease).toBe(true);

    await runCli(["node", "hi", "config", "--no-pre-release"], ctx, {
      exitOverride: true,
    });
    expect(ctx.config.preRelease).toBe(false);
  });

  test("show-completion prints a script", async () => {
    const io = new FakeIO();
    const { ctx, cleanup } = await createTestContext({ io });
    cleanups.push(cleanup);

    const code = await runCli(["node", "hi", "--show-completion", "bash"], ctx, {
      exitOverride: true,
    });
    expect(code).toBe(0);
    expect(io.output()).toContain("complete -F _hi_complete hi");
  });

  test("unsupported shell is rejected", async () => {
    const { ctx, cleanup } = await createTestContext();
    cleanups.push(cleanup);
    const code = await runCli(["node", "hi", "--show-completion", "tcsh"], ctx, {
      exitOverride: true,
    });
    expect(code).toBe(1);
  });
});
