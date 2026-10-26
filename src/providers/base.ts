import type { ProviderId } from "../schemas.ts";

export const PROVIDER_STATE_KEY_PREFIXES: Record<string, string> = {
  github: "https://github.com",
  gitlab: "https://gitlab.com",
  codeberg: "https://codeberg.org",
  "gitlab-self": "gitlab@",
  "forgejo-self": "forgejo@",
  mise: "mise:",
  docker: "docker:",
};

export function resolveProvider(source: string): ProviderId | null {
  if (source.startsWith("mise@")) return "mise";
  if (source.startsWith("docker@")) return "docker";
  if (source.startsWith("gitlab@")) return "gitlab-self";
  if (source.startsWith("forgejo@")) return "forgejo-self";

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }

  switch (url.hostname.toLowerCase()) {
    case "github.com":
      return "github";
    case "gitlab.com":
      return "gitlab";
    case "codeberg.org":
      return "codeberg";
    default:
      return null;
  }
}

function pathSegments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

export function normalizeRepositorySource(source: string): string {
  if (source.startsWith("gitlab@") || source.startsWith("forgejo@")) {
    return source.replace(/\/+$/, "");
  }

  const url = new URL(source);
  const segments = pathSegments(url);
  if (segments.length < 2) {
    throw new Error(`Repository URL must include an owner and repository: ${source}`);
  }

  const host = url.hostname.toLowerCase();
  const keep = host === "gitlab.com" ? segments.length : 2;
  return `https://${url.hostname}/${segments.slice(0, keep).join("/")}`;
}

export function splitPrefixedUrl(source: string, prefix: string): { host: string; path: string } {
  const parts = source
    .slice(prefix.length)
    .replace(/^\/+|\/+$/g, "")
    .split("/");
  if (parts.length < 3 || parts.some((part) => part.length === 0)) {
    throw new Error(`URL must be of the form ${prefix}<host>/<owner>/<repo>: ${source}`);
  }
  return { host: parts[0] as string, path: parts.slice(1).join("/") };
}

export function repoNameFromSource(source: string): string {
  return source.replace(/\/+$/, "").split("/").pop() ?? source;
}
