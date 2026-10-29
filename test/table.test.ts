import { describe, expect, test } from "bun:test";
import { DIM_TABLE_THEME, renderTable } from "../src/ui/table.ts";

const BOX_CHARS = /[┏┓┗┛┃┡┩╇━┳┴│─└┘┌┐├┤┬┴┼]/;

describe("renderTable", () => {
  test("renders no box-drawing borders", () => {
    const text = renderTable(
      [
        { Name: "code-server", Version: "v4.143.1", Type: "binary" },
        { Name: "ripgrep", Version: "v14", Type: "deb" },
      ],
      { title: "Tools to be installed" },
    );
    expect(text).not.toMatch(BOX_CHARS);
  });

  test("renders a single row as a vertical field list", () => {
    const text = renderTable(
      [
        {
          Name: "code-server",
          "Selected Item": "code-server-4.143.1-linux-amd64.tar.gz",
          Version: "v4.143.1",
        },
      ],
      { title: "🚀 Install: code-server" },
    );
    const lines = text.trimStart().split("\n");
    expect(lines[0]).toContain("🚀 Install: code-server");
    const nameLine = lines.find((line) => line.includes("Name"));
    const itemLine = lines.find((line) => line.includes("Selected Item"));
    expect(nameLine).toContain("code-server");
    expect(itemLine).toContain("code-server-4.143.1-linux-amd64.tar.gz");
    expect(nameLine).not.toContain("Selected Item");
  });

  test("aligns columns without wrapping short values", () => {
    const text = renderTable(
      [
        { ID: 1, File: "a.tar.gz" },
        { ID: 12, File: "b.tar.gz" },
      ],
      { title: "Assets", theme: DIM_TABLE_THEME },
    );
    const lines = text.split("\n");
    const idHeader = lines.findIndex((line) => line.includes("ID"));
    const first = lines[idHeader + 1] as string;
    const second = lines[idHeader + 2] as string;
    expect(first.indexOf("a.tar.gz")).toBe(second.indexOf("b.tar.gz"));
  });

  test("truncates oversized non-final cells", () => {
    const long = "x".repeat(120);
    const text = renderTable(
      [
        { File: long, Count: 3 },
        { File: "short.bin", Count: 4 },
      ],
      {},
    );
    const row = text.split("\n").find((line) => line.includes("…"));
    expect(row).toBeDefined();
    expect(row).not.toContain(long);
  });

  test("returns an empty string for empty data", () => {
    expect(renderTable([], { title: "Nothing" })).toBe("");
  });
});
