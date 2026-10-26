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
