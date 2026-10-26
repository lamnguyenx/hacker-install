import { describe, expect, test } from "bun:test";
import { invokedBinaryName, isGlobalPackageInstall } from "../src/app/me.ts";

describe("binary name detection", () => {
  test("uses the compiled executable name", () => {
    expect(invokedBinaryName("/home/u/bin/ir", ["ir"], {})).toBe("ir");
    expect(invokedBinaryName("/usr/local/bin/hacker-install-ts", [], {})).toBe("hacker-install-ts");
  });

  test("uses process.title for symlinked compiled binaries", () => {
    expect(
      invokedBinaryName(
        "/home/u/bin/hacker-install-darwin-arm64",
        ["bun", "/$bunfs/root/index.ts"],
        {},
        "/home/u/bin/hi",
      ),
    ).toBe("hi");
  });

  test("falls back to hi for Bun-run TypeScript", () => {
    expect(invokedBinaryName("/usr/local/bin/bun", ["bun", "/src/cli.ts"], {})).toBe("hi");
    expect(invokedBinaryName("/usr/local/bin/bun", ["bun", "/src/index.ts"], {})).toBe("hi");
    expect(invokedBinaryName("/usr/local/bin/bun", ["bun", "/src/index.js"], {})).toBe("hi");
  });

  test("uses the invoked bin name for npm symlinks", () => {
    expect(invokedBinaryName("/usr/local/bin/bun", ["bun", "/usr/local/bin/hi"], {})).toBe("hi");
  });

  test("honours the explicit override", () => {
    expect(invokedBinaryName("/usr/local/bin/bun", [], { HI_BINARY_NAME: "custom" })).toBe(
      "custom",
    );
  });

  test("detects global npm/Bun installs", () => {
    expect(
      isGlobalPackageInstall(
        ["bun", "/home/u/.bun/install/global/node_modules/hacker-install-ts/dist/npm/index.js"],
        {},
      ),
    ).toBe(true);
    expect(isGlobalPackageInstall(["bun", "/src/index.ts"], {})).toBe(false);
  });
});
