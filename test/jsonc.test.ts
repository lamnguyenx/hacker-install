import { describe, expect, test } from "bun:test";
import { parseJsonc } from "../src/jsonc.ts";

describe("parseJsonc", () => {
  test("supports line/block comments and trailing commas", () => {
    const text = `
    {
      // line comment
      "url": "https://example.com/a//b",
      "nested": {
        "values": [1, 2, 3,],
      },
      /* block comment */
      "enabled": true,
    }
    `;

    expect(parseJsonc(text)).toEqual({
      url: "https://example.com/a//b",
      nested: { values: [1, 2, 3] },
      enabled: true,
    });
  });

  test("preserves comment markers inside strings", () => {
    expect(parseJsonc('{"a": "/* not a comment */", "b": "// nope"}')).toEqual({
      a: "/* not a comment */",
      b: "// nope",
    });
  });

  test("handles escaped quotes", () => {
    expect(parseJsonc('{"a": "say \\"hi\\" // ok",}')).toEqual({
      a: 'say "hi" // ok',
    });
  });
});
