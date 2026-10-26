import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseIniValue } from "../src/pkgs/base.ts";
import { detectPackageTypeFromAssetName, PackageInstaller } from "../src/pkgs/main.ts";
import { FakeExec, silentLogger } from "./helpers.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hi-pkgs-"));
  dirs.push(dir);
  return dir;
}

describe("package type detection", () => {
  test("detects asset extensions", () => {
    expect(detectPackageTypeFromAssetName("tool.deb")).toBe("deb");
    expect(detectPackageTypeFromAssetName("tool.rpm")).toBe("rpm");
    expect(detectPackageTypeFromAssetName("tool.AppImage")).toBe("AppImage");
    expect(detectPackageTypeFromAssetName("tool.appimage")).toBe("AppImage");
    expect(detectPackageTypeFromAssetName("tool.tar.gz")).toBeNull();
  });

  test("parses desktop entry values", () => {
    const text = "[Desktop Entry]\nName=Demo\nExec=/opt/demo %U\n";
    expect(parseIniValue(text, "Desktop Entry", "Exec")).toBe("/opt/demo %U");
    expect(parseIniValue(text, "Desktop Entry", "Missing")).toBeNull();
  });
});

describe("PackageInstaller", () => {
  test("installs a deb and uses the metadata package name", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(join(dir, "nested", "tool.deb"), "deb");

    const exec = new FakeExec((args) => {
      if (args[0] === "dpkg-deb") return { stdout: "rioterm\n" };
      if (args[0] === "sudo" && args[1] === "dpkg") return { code: 0 };
      return { code: 0 };
    });
    const installer = new PackageInstaller("rio", {
      packageType: "deb",
      exec,
      logger: silentLogger(),
    });

    expect(await installer.install(dir)).toBe("rioterm");
    expect(installer.name).toBe("rioterm");
    expect(exec.calls.some((args) => args[0] === "dpkg-deb")).toBe(true);
  });

  test("installs an rpm with the rpm metadata name", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "tool.rpm"), "rpm");

    const exec = new FakeExec((args) => {
      if (args[0] === "rpm" && args[1] === "-qp") return { stdout: "demo-pkg\n" };
      if (args[0] === "sudo") return { code: 0 };
      return { code: 0 };
    });
    const installer = new PackageInstaller("demo", {
      packageType: "rpm",
      exec,
      logger: silentLogger(),
    });

    expect(await installer.install(dir)).toBe("demo-pkg");
  });

  test("reports a missing package file", async () => {
    const dir = await tempDir();
    const installer = new PackageInstaller("demo", {
      packageType: "deb",
      exec: new FakeExec(),
      logger: silentLogger(),
    });
    expect(await installer.install(dir)).toBeNull();
  });
});
