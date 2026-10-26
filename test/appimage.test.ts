import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunExecRunner } from "../src/exec.ts";
import { AppImage } from "../src/pkgs/appimage.ts";
import { silentLogger } from "./helpers.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hi-appimage-"));
  dirs.push(dir);
  return dir;
}

describe("AppImage installer", () => {
  test("installs, writes a desktop entry, and uninstalls", async () => {
    const dir = await tempDir();
    const source = join(dir, "Demo.AppImage");
    const appimage = join(dir, "share", "appimages", "demo.appimage");
    const desktop = join(dir, "applications", "demo.desktop");
    const icon = join(dir, "icons", "demo.png");

    await writeFile(
      source,
      `#!/bin/sh
if [ "$1" = "--appimage-extract" ]; then
  mkdir -p squashfs-root/usr/share/applications
  printf '[Desktop Entry]\\nName=Demo\\nExec=/opt/demo %%U\\n' > squashfs-root/demo.desktop
  printf 'icon-bytes' > squashfs-root/.DirIcon
fi
`,
      { mode: 0o755 },
    );
    await chmod(source, 0o755);

    const installer = new AppImage("demo", {
      appimagePath: appimage,
      desktopEntryPath: desktop,
      iconPath: icon,
      exec: new BunExecRunner(),
      logger: silentLogger(),
    });

    expect(await installer.install(source)).toBe(appimage);
    expect((await stat(appimage)).isFile()).toBe(true);
    expect(await readFile(icon, "utf8")).toBe("icon-bytes");
    const desktopText = await readFile(desktop, "utf8");
    expect(desktopText).toContain("Name=demo");
    expect(desktopText).toContain("Exec=");
    expect(desktopText).toContain("StartupWMClass=demo");

    expect(await installer.uninstall()).toBe(true);
    await expect(stat(appimage)).rejects.toThrow();
    await expect(stat(desktop)).rejects.toThrow();
    await expect(stat(icon)).rejects.toThrow();
  });

  test("rejects a non-AppImage source", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "nested"), { recursive: true });
    const source = join(dir, "nested", "tool.deb");
    await writeFile(source, "not an appimage");
    const installer = new AppImage("demo", {
      appimagePath: join(dir, "appimage"),
      desktopEntryPath: join(dir, "desktop"),
      iconPath: join(dir, "icon"),
      exec: new BunExecRunner(),
      logger: silentLogger(),
    });
    expect(await installer.install(source)).toBeNull();
  });
});
