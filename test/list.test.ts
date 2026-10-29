import { describe, expect, test } from "bun:test";
import { renderToolList, type ToolListEntry, textWidth } from "../src/ui/list.ts";

function entry(overrides: Partial<ToolListEntry> = {}): ToolListEntry {
  return {
    name: "code-server",
    version: "v4.143.1",
    type: "binary",
    provider: "github",
    hold: false,
    source: "https://github.com/coder/code-server",
    description: "VS Code in the browser",
    ...overrides,
  };
}

describe("tool list", () => {
  test("renders one block per tool with header, source and description", () => {
    const out = renderToolList([entry(), entry({ name: "deno", version: "v2.0.0" })]);
    const lines = out.split("\n");
    expect(lines[0]).toContain("Installed tools");
    expect(lines[0]).toContain("(2)");
    expect(out).toContain("code-server");
    expect(out).toContain("v4.143.1");
    expect(out).toContain("github.com/coder/code-server");
    expect(out).toContain("VS Code in the browser");
    expect(out).toContain("\n\n");
  });

  test("keeps every line inside the terminal width", () => {
    const out = renderToolList(
      [
        entry({
          name: "a-very-long-tool-name-that-would-wrap",
          description: "A very long description ".repeat(5),
          source: "https://github.com/some-owner/some-really-long-repository-name",
        }),
      ],
      { width: 40 },
    );
    for (const line of out.split("\n")) {
      expect(textWidth(line)).toBeLessThanOrEqual(40);
    }
  });

  test("drops low priority tags instead of truncating them", () => {
    const out = renderToolList([entry({ provider: "forgejo-self", hold: true })], { width: 44 });
    const tags = out.split("\n")[2] ?? "";
    expect(tags).toContain("code-server");
    expect(tags).toContain("v4.143.1");
    expect(tags).toContain("forgejo");
    expect(tags).not.toContain("held");
  });

  test("renders the symlink and its target with a shortened home directory", () => {
    const out = renderToolList(
      [
        entry({
          type: "bundle",
          symlink: {
            path: "/home/me/.local/bin/code-server",
            target:
              "/home/me/Downloads2/code-server/code-server-4.143.1-linux-amd64/bin/code-server",
          },
        }),
      ],
      { width: 120, home: "/home/me" },
    );
    expect(out).toContain(
      "~/.local/bin/code-server -> " +
        "~/Downloads2/code-server/code-server-4.143.1-linux-amd64/bin/code-server",
    );
  });

  test("puts a long symlink target on its own line instead of truncating it", () => {
    const out = renderToolList(
      [
        entry({
          type: "bundle",
          symlink: {
            path: "/Users/lamnt45/.local/bin/code-server",
            target: "/Users/lamnt45/Downloads2/code-server/bin/code-server",
          },
        }),
      ],
      { width: 80 },
    );
    expect(out).toContain(
      "\n  /Users/lamnt45/.local/bin/code-server\n" +
        "  -> /Users/lamnt45/Downloads2/code-server/bin/code-server\n",
    );
  });

  test("wraps a versioned target instead of truncating it", () => {
    const target =
      "/Users/lamnt45/Downloads2/code-server/code-server-4.143.1-linux-amd64/bin/code-server";
    const out = renderToolList(
      [
        entry({
          type: "bundle",
          symlink: { path: "/Users/lamnt45/.local/bin/code-server", target },
        }),
      ],
      { width: 80 },
    );
    const lines = out.split("\n");
    expect(out).not.toContain("…");
    expect(lines[4]).toContain("-> /Users/lamnt45/Downloads2/code-server/");
    const wrapped = [lines[4] ?? "", lines[5] ?? ""]
      .map((line) => line.trim().replace(/^->\s*/, ""))
      .join("");
    expect(wrapped).toBe(target);
    for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(80);
  });

  test("keeps split symlink lines inside the width", () => {
    const out = renderToolList(
      [
        entry({
          type: "bundle",
          symlink: {
            path: "/home/me/.local/bin/code-server",
            target: "/home/me/Downloads2/code-server/bin/code-server",
          },
        }),
      ],
      { width: 40, home: "/home/me" },
    );
    const lines = out.split("\n");
    expect(lines[3]).toContain("~/.local/bin/code-server");
    expect(lines[4]).toContain("-> ~/Downloads2");
    for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(40);
  });

  test("shows the hold marker when it fits", () => {
    expect(renderToolList([entry({ hold: true })], { width: 80 })).toContain("held");
  });

  test("omits the detail line when the entry has no source or description", () => {
    const out = renderToolList([entry({ source: "", description: "" })], { width: 80 });
    expect(out.split("\n").filter(Boolean)).toHaveLength(2);
  });

  test("does not truncate when width is unset or zero", () => {
    const description = "A very long description ".repeat(5).trim();
    for (const width of [undefined, 0]) {
      const out = renderToolList([entry({ description })], { width });
      expect(out).toContain(description);
    }
  });
});
