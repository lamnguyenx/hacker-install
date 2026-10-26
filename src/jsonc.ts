/**
 * JSONC parser for config files: strips `//` and `/* *\/` comments and trailing
 * commas while preserving comment markers inside string values (URLs such as
 * `https://...`).
 */
export function parseJsonc<T = unknown>(text: string): T {
  const cleaned: string[] = [];
  let index = 0;
  const length = text.length;
  let inString = false;
  let escaped = false;

  while (index < length) {
    const char = text[index] as string;

    if (inString) {
      cleaned.push(char);
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      cleaned.push(char);
      index += 1;
      continue;
    }

    if (text.startsWith("//", index)) {
      const newline = text.indexOf("\n", index);
      index = newline === -1 ? length : newline;
      continue;
    }

    if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? length : end + 2;
      cleaned.push(" ");
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;
      while (lookahead < length && /\s/.test(text[lookahead] as string)) {
        lookahead += 1;
      }
      const next = text[lookahead];
      if (next === "}" || next === "]") {
        index += 1;
        continue;
      }
    }

    cleaned.push(char);
    index += 1;
  }

  return JSON.parse(cleaned.join("")) as T;
}
