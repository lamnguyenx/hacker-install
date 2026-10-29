export const DEFAULT_HTTP_TIMEOUT_MS = 60_000;
export const USER_AGENT = "hacker-install";

export interface HttpOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface HttpClient {
  get(url: string, options?: HttpOptions): Promise<Response>;
  getJson<T = unknown>(url: string, options?: HttpOptions): Promise<T>;
  getText(url: string, options?: HttpOptions): Promise<string>;
}

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;

  constructor(url: string, status: number, body: string) {
    super(`HTTP ${status} for ${url}${body ? `: ${body.slice(0, 300)}` : ""}`);
    this.name = "HttpError";
    this.url = url;
    this.status = status;
    this.body = body;
  }
}

export class FetchHttpClient implements HttpClient {
  async get(url: string, options: HttpOptions = {}): Promise<Response> {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      ...(options.headers ?? {}),
    };
    const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    const signal = options.signal ?? (timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined);

    return fetch(url, {
      method: "GET",
      headers,
      signal,
      redirect: "follow",
    });
  }

  async getJson<T = unknown>(url: string, options: HttpOptions = {}): Promise<T> {
    const response = await this.get(url, options);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new HttpError(url, response.status, body);
    }
    return (await response.json()) as T;
  }

  async getText(url: string, options: HttpOptions = {}): Promise<string> {
    const response = await this.get(url, options);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new HttpError(url, response.status, body);
    }
    return response.text();
  }
}

export const defaultHttpClient = new FetchHttpClient();
