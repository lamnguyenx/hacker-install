export function isValidToolName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 128 &&
    name !== "." &&
    name !== ".." &&
    !name.startsWith("-") &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !/\s/.test(name) &&
    ![...name].some((char) => char.charCodeAt(0) < 32)
  );
}

export function isNone(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

export function toWords(text: string, ignoreWords: string[] = []): string[] {
  const ignored = new Set(ignoreWords);
  return text
    .toLowerCase()
    .replaceAll("_", "-")
    .split("-")
    .map((part) => part.replace(/\d/g, ""))
    .filter((word) => word.length > 0 && !ignored.has(word));
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Math.max(1, Math.min(limit, items.length || 1));

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 2)).trimEnd()}..`;
}

export function basenameWithoutExtension(value: string): string {
  const slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  const base = slash >= 0 ? value.slice(slash + 1) : value;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        substitution,
      );
    }
    previous = current;
  }
  return previous[b.length] as number;
}

export function getCloseMatches(
  query: string,
  candidates: string[],
  limit = 10,
  cutoff = 0.7,
): string[] {
  const normalized = query.toLowerCase();
  const scored = candidates
    .map((candidate) => {
      const value = candidate.toLowerCase();
      const distance = levenshtein(normalized, value);
      const ratio = 1 - distance / Math.max(normalized.length, value.length, 1);
      return { candidate, ratio };
    })
    .filter((entry) => entry.ratio >= cutoff)
    .sort((a, b) => b.ratio - a.ratio || a.candidate.localeCompare(b.candidate));
  return scored.slice(0, limit).map((entry) => entry.candidate);
}
