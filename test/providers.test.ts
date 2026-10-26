import { describe, expect, test } from "bun:test";
import {
  normalizeRepositorySource,
  resolveProvider,
  splitPrefixedUrl,
} from "../src/providers/base.ts";
import { getRelease } from "../src/providers/git/base.ts";
import { ForgejoInfo, SelfHostedForgejoInfo } from "../src/providers/git/forgejo.ts";
import { GitHubInfo } from "../src/providers/git/github.ts";
import { GitlabInfo, SelfHostedGitlabInfo } from "../src/providers/git/gitlab.ts";
import { FakeHttp, jsonResponse, silentLogger, TEST_PLATFORM } from "./helpers.ts";

const logger = silentLogger();

function githubHttp(assets = true): FakeHttp {
  const asset = {
    browser_download_url: "https://example.com/tool-linux-x86_64.tar.gz",
    content_type: "application/gzip",
    created_at: "2026-01-01T00:00:00Z",
    download_count: 7,
    id: 1,
    name: "tool-linux-x86_64.tar.gz",
    node_id: "n",
    size: 1_000_000,
    state: "uploaded",
    updated_at: "2026-01-01T00:00:00Z",
  };
  return new FakeHttp((url) => {
    if (url === "https://api.github.com/repos/o/r") {
      return jsonResponse({
        name: "r",
        full_name: "o/r",
        html_url: "https://github.com/o/r",
        description: "demo",
        language: "Rust",
        stargazers_count: 42,
      });
    }
    if (url.includes("/releases")) {
      return jsonResponse({
        tag_name: "v1.2.3",
        prerelease: false,
        published_at: "2026-01-02T00:00:00Z",
        assets: assets ? [asset] : [],
      });
    }
    return jsonResponse({ message: "not found" }, 404);
  });
}

describe("provider resolution", () => {
  test("resolves supported sources", () => {
    expect(resolveProvider("https://github.com/o/r")).toBe("github");
    expect(resolveProvider("https://gitlab.com/o/r")).toBe("gitlab");
    expect(resolveProvider("https://codeberg.org/o/r")).toBe("codeberg");
    expect(resolveProvider("gitlab@host/o/r")).toBe("gitlab-self");
    expect(resolveProvider("forgejo@host/o/r")).toBe("forgejo-self");
    expect(resolveProvider("mise@terraform")).toBe("mise");
    expect(resolveProvider("docker@alpine")).toBe("docker");
    expect(resolveProvider("https://example.com/o/r")).toBeNull();
  });

  test("normalizes repository URLs", () => {
    expect(normalizeRepositorySource("https://github.com/o/r/tree/main")).toBe(
      "https://github.com/o/r",
    );
    expect(normalizeRepositorySource("https://gitlab.com/g/sub/r/-/releases")).toBe(
      "https://gitlab.com/g/sub/r/-/releases",
    );
    expect(normalizeRepositorySource("gitlab@host/g/sub/r")).toBe("gitlab@host/g/sub/r");
    expect(() => normalizeRepositorySource("https://github.com/o")).toThrow();
  });

  test("splits prefixed self-hosted URLs", () => {
    expect(splitPrefixedUrl("gitlab@host/g/sub/tool", "gitlab@")).toEqual({
      host: "host",
      path: "g/sub/tool",
    });
    expect(() => splitPrefixedUrl("gitlab@host/tool", "gitlab@")).toThrow();
  });
});

describe("GitHub provider", () => {
  test("loads info and parses the latest release", async () => {
    const http = githubHttp();
    const repo = await GitHubInfo.create("https://github.com/o/r", {
      http,
      logger,
      token: "secret",
    });

    expect(repo.api).toBe("https://api.github.com/repos/o/r");
    expect(repo.repoUrl).toBe("https://github.com/o/r");
    expect(repo.info?.stargazersCount).toBe(42);
    const auth = http.requests[0]?.options.headers?.Authorization;
    expect(auth).toBe(`Basic ${Buffer.from("user:secret").toString("base64")}`);

    const releases = await repo.release();
    expect(releases).toHaveLength(1);
    expect(releases[0]?.tagName).toBe("v1.2.3");
    expect(releases[0]?.assets[0]?.name).toBe("tool-linux-x86_64.tar.gz");
    expect(releases[0]?.assets[0]?.downloadCount).toBe(7);
  });

  test("uses the tag endpoint when a version is requested", async () => {
    const http = new FakeHttp((url) => {
      if (url.includes("/repos/o/r") && !url.includes("/releases")) {
        return jsonResponse({ name: "r", full_name: "o/r", stargazers_count: 1 });
      }
      expect(url).toContain("/releases/tags/v1.2.3");
      return jsonResponse({
        tag_name: "v1.2.3",
        prerelease: false,
        published_at: "2026-01-02T00:00:00Z",
        assets: [],
      });
    });
    const repo = await GitHubInfo.create("https://github.com/o/r", { http, logger });
    const releases = await repo.release("v1.2.3");
    expect(releases[0]?.tagName).toBe("v1.2.3");
  });

  test("returns an empty list on API errors", async () => {
    const http = new FakeHttp((url) => {
      if (url.includes("/repos/o/r") && !url.includes("/releases")) {
        return jsonResponse({ name: "r", full_name: "o/r" });
      }
      return jsonResponse({ message: "boom" }, 500);
    });
    const repo = await GitHubInfo.create("https://github.com/o/r", { http, logger });
    expect(await repo.release()).toEqual([]);
  });
});

describe("GitLab provider", () => {
  test("maps info and builds encoded API URLs", async () => {
    const http = new FakeHttp((url) => {
      if (url === "https://gitlab.com/api/v4/projects/g%2Fsub%2Ftool") {
        return jsonResponse({
          name: "tool",
          path_with_namespace: "g/sub/tool",
          web_url: "https://gitlab.com/g/sub/tool",
          description: "demo",
          predominant_language: "Go",
          star_count: 5,
        });
      }
      if (url.endsWith("/releases")) {
        return jsonResponse([
          {
            tag_name: "v1.0.0",
            upcoming_release: false,
            created_at: "2026-01-01T00:00:00Z",
            assets: {
              links: [
                {
                  name: "tool-linux-x86_64.tar.gz",
                  direct_asset_url: "https://example.com/tool.tar.gz",
                  link_type: "package",
                  count: 3,
                  id: 1,
                },
              ],
            },
          },
        ]);
      }
      return jsonResponse({ message: "not found" }, 404);
    });

    const repo = await GitlabInfo.create("https://gitlab.com/g/sub/tool", {
      http,
      logger,
      token: "glpat",
    });
    expect(repo.api).toBe("https://gitlab.com/api/v4/projects/g%2Fsub%2Ftool");
    expect(repo.info?.stargazersCount).toBe(5);
    expect(http.requests[0]?.options.headers?.["PRIVATE-TOKEN"]).toBe("glpat");

    const releases = await repo.release();
    expect(releases[0]?.assets[0]?.browserDownloadUrl).toBe("https://example.com/tool.tar.gz");
    expect(releases[0]?.assets[0]?.downloadCount).toBe(3);
  });

  test("self-hosted GitLab keeps subgroups", async () => {
    const http = new FakeHttp((url) => {
      if (url.endsWith("/api/v4/projects/g%2Fsub%2Ftool")) {
        return jsonResponse({ name: "tool", path_with_namespace: "g/sub/tool" });
      }
      return jsonResponse([]);
    });
    const repo = await SelfHostedGitlabInfo.create("gitlab@gitlab.example.com/g/sub/tool", {
      http,
      logger,
    });
    expect(repo.host).toBe("gitlab.example.com");
    expect(repo.projectPath).toBe("g/sub/tool");
    expect(repo.repoName).toBe("tool");
    expect(repo.repoUrl).toBe("gitlab@gitlab.example.com/g/sub/tool");
  });
});

describe("Forgejo provider", () => {
  test("derives the API base and maps stars_count", async () => {
    const http = new FakeHttp((url) => {
      if (url === "https://codeberg.org/api/v1/repos/o/r") {
        return jsonResponse({
          name: "r",
          full_name: "o/r",
          description: "demo",
          stars_count: 9,
        });
      }
      return jsonResponse({ message: "not found" }, 404);
    });
    const repo = await ForgejoInfo.create("https://codeberg.org/o/r", {
      http,
      logger,
      token: "cb",
    });
    expect(repo.api).toBe("https://codeberg.org/api/v1/repos/o/r");
    expect(repo.info?.stargazersCount).toBe(9);
    expect(http.requests[0]?.options.headers?.Authorization).toBe("token cb");
  });

  test("lists releases and picks the newest", async () => {
    const http = new FakeHttp((url) => {
      if (url === "https://codeberg.org/api/v1/repos/o/r") {
        return jsonResponse({ name: "r", full_name: "o/r", stars_count: 0 });
      }
      return jsonResponse([
        {
          tag_name: "v1.0.0",
          draft: false,
          prerelease: false,
          published_at: "2026-01-01T00:00:00Z",
          assets: [],
        },
        {
          tag_name: "v2.0.0",
          draft: false,
          prerelease: false,
          published_at: "2026-02-01T00:00:00Z",
          assets: [{ name: "tool.tar.gz", browser_download_url: "https://x/tool.tar.gz" }],
        },
      ]);
    });
    const repo = await ForgejoInfo.create("https://codeberg.org/o/r", { http, logger });
    const releases = await repo.release();
    expect(releases).toHaveLength(1);
    expect(releases[0]?.tagName).toBe("v2.0.0");
  });

  test("self-hosted Forgejo derives the host", async () => {
    const http = new FakeHttp((url) => {
      if (url === "https://git.example.com/api/v1/repos/o/r") {
        return jsonResponse({ name: "r", full_name: "o/r", stars_count: 0 });
      }
      return jsonResponse([]);
    });
    const repo = await SelfHostedForgejoInfo.create("forgejo@git.example.com/o/r", {
      http,
      logger,
    });
    expect(repo.api).toBe("https://git.example.com/api/v1/repos/o/r");
    expect(repo.repoUrl).toBe("forgejo@git.example.com/o/r");
  });
});

describe("release selection", () => {
  test("allows a single requested pre-release with assets", () => {
    const asset = getRelease(
      [
        {
          source: "https://github.com/o/r",
          name: "r",
          tagName: "v2.0.0-beta.1",
          prerelease: true,
          publishedAt: "2026-01-01T00:00:00Z",
          description: "",
          assets: [
            {
              browserDownloadUrl: "https://x/linux",
              contentType: "",
              createdAt: "",
              downloadCount: 0,
              id: 1,
              name: "tool-linux-x86_64.tar.gz",
              nodeId: "",
              size: 1,
              state: "",
              updatedAt: "",
            },
          ],
        },
      ],
      {
        repoUrl: "https://github.com/o/r",
        platform: TEST_PLATFORM,
        logger,
      },
    );
    expect(asset?.name).toBe("tool-linux-x86_64.tar.gz");
  });

  test("selects an asset by platform score", () => {
    const asset = getRelease(
      [
        {
          source: "https://github.com/o/r",
          name: "r",
          tagName: "v1.0.0",
          prerelease: false,
          publishedAt: "2026-01-01T00:00:00Z",
          description: "",
          assets: [
            {
              ...{
                browserDownloadUrl: "https://x/win",
                contentType: "",
                createdAt: "",
                downloadCount: 0,
                id: 1,
                name: "tool-windows-x64.zip",
                nodeId: "",
                size: 1,
                state: "",
                updatedAt: "",
              },
            },
            {
              browserDownloadUrl: "https://x/linux",
              contentType: "",
              createdAt: "",
              downloadCount: 0,
              id: 2,
              name: "tool-linux-x86_64.tar.gz",
              nodeId: "",
              size: 1,
              state: "",
              updatedAt: "",
            },
          ],
        },
      ],
      {
        repoUrl: "https://github.com/o/r",
        platform: TEST_PLATFORM,
        logger,
      },
    );
    expect(asset?.name).toBe("tool-linux-x86_64.tar.gz");
  });
});
