import { describe, expect, test } from "bun:test";
import { ReleaseScorer } from "../src/helper/release-scorer.ts";
import type { PlatformInfo } from "../src/platform.ts";
import { silentLogger, TEST_PLATFORM } from "./helpers.ts";

const CODE_SERVER_ASSETS = [
  "code-server-4.143.1-amd64.rpm",
  "code-server-4.143.1-arm64.rpm",
  "code-server-4.143.1-linux-amd64.tar.gz",
  "code-server-4.143.1-linux-arm64.tar.gz",
  "code-server-4.143.1-macos-amd64.tar.gz",
  "code-server-4.143.1-macos-arm64.tar.gz",
  "code-server-4.143.1-windows-amd64.tar.gz",
  "code-server_4.143.1_amd64.deb",
  "code-server_4.143.1_arm64.deb",
  "package.tar.gz",
];

function platform(overrides: Partial<PlatformInfo>): ReleaseScorer {
  return new ReleaseScorer({
    platform: { ...TEST_PLATFORM, ...overrides },
    logger: silentLogger(),
  });
}

describe("ReleaseScorer platform matching", () => {
  test("macOS does not pick a Linux asset", () => {
    const best = platform({ system: "darwin", arch: "aarch64" }).selectBest(CODE_SERVER_ASSETS);
    expect(best).toBe("code-server-4.143.1-macos-arm64.tar.gz");
  });

  test("darwin is not mistaken for windows", () => {
    const best = platform({ system: "darwin", arch: "x86_64" }).selectBest([
      "tool-darwin-amd64.tar.gz",
      "tool-windows-amd64.tar.gz",
    ]);
    expect(best).toBe("tool-darwin-amd64.tar.gz");
  });

  test("linux prefers a linux asset", () => {
    const best = platform({ system: "linux", arch: "aarch64" }).selectBest(CODE_SERVER_ASSETS);
    expect(best).toBe("code-server-4.143.1-linux-arm64.tar.gz");
  });

  test("windows tokens are recognised", () => {
    const best = platform({ system: "windows", arch: "x86_64" }).selectBest([
      "tool-win64.zip",
      "tool-linux-x64.zip",
      "tool-macos-arm64.zip",
    ]);
    expect(best).toBe("tool-win64.zip");
  });

  test("foreign platform assets score lower", () => {
    const scorer = platform({ system: "darwin", arch: "aarch64" });
    expect(scorer.score("tool-macos-arm64.tar.gz")).toBeGreaterThan(
      scorer.score("tool-linux-arm64.tar.gz"),
    );
  });
});

describe("ReleaseScorer package adjustments", () => {
  test("native packages are penalised without a package hint", () => {
    const scorer = platform({ packageFamily: "deb" });
    expect(scorer.selectBest(["tool.deb", "tool.tar.gz"])).toBe("tool.tar.gz");
  });

  test("requested package type wins", () => {
    const scorer = new ReleaseScorer({
      platform: { ...TEST_PLATFORM, packageFamily: "deb" },
      extraWords: ["deb"],
      logger: silentLogger(),
    });
    expect(scorer.selectBest(["tool.deb", "tool.tar.gz"])).toBe("tool.deb");
  });

  test("mismatched package family is penalised", () => {
    const scorer = platform({ packageFamily: "rpm" });
    expect(scorer.selectBest(["tool-linux-x86_64.deb", "tool-linux-x86_64.rpm"])).toBe(
      "tool-linux-x86_64.rpm",
    );
  });

  test("AppImage is penalised without a desktop environment", () => {
    const scorer = platform({ hasDesktopEnv: false });
    expect(scorer.selectBest(["tool-linux-x86_64.AppImage", "tool-linux-x86_64.tar.gz"])).toBe(
      "tool-linux-x86_64.tar.gz",
    );
  });

  test("musl is preferred on non-glibc systems", () => {
    const scorer = platform({ isGlibc: false });
    expect(
      scorer.selectBest(["tool-linux-x86_64-gnu.tar.gz", "tool-linux-x86_64-musl.tar.gz"]),
    ).toBe("tool-linux-x86_64-musl.tar.gz");
  });
});

describe("ReleaseScorer selection", () => {
  test("single asset is returned regardless of score", () => {
    const scorer = platform({ system: "darwin", arch: "aarch64" });
    expect(scorer.selectBest(["tool-linux-x86_64.tar.gz"])).toBe("tool-linux-x86_64.tar.gz");
  });

  test("disabling adjustments suppresses the musl penalty", () => {
    const adjusted = platform({ isGlibc: true });
    const disabled = new ReleaseScorer({
      platform: { ...TEST_PLATFORM, isGlibc: true },
      disableAdjustments: true,
      logger: silentLogger(),
    });
    expect(disabled.score("tool-linux-x86_64-musl.tar.gz")).toBeGreaterThan(
      adjusted.score("tool-linux-x86_64-musl.tar.gz"),
    );
  });

  test("no result when every score is below the threshold", () => {
    const scorer = platform({ system: "darwin", arch: "aarch64" });
    expect(scorer.selectBest(["tool-freebsd-riscv64", "tool-plan9-mips"])).toBeNull();
  });

  test("getInfo exposes patterns", () => {
    const info = platform({}).getInfo();
    expect(info.platform).toBe("linux");
    expect(Array.isArray(info.allPatterns)).toBe(true);
  });
});
