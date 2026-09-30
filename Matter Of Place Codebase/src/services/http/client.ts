import { ServiceError } from "../types";

/**
 * Minimal JSON client for the Matter of Place API. The API is same-origin in
 * production (Cloudflare Worker route `/api/*`), so no credentials or CORS
 * configuration are needed; a different origin works as long as it allows
 * the site's origin.
 */
export type ApiClient = {
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
};

const kindForStatus = (status: number) => {
  if (status === 404) return "not-found" as const;
  if (status === 400 || status === 422) return "validation" as const;
  return "server" as const;
};

export function createApiClient(baseUrl: string): ApiClient {
  const request = async <T>(path: string, init: RequestInit): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { accept: "application/json", ...init.headers },
      });
    } catch (error) {
      throw new ServiceError("network", error instanceof Error ? error.message : "Network error");
    }
    if (!response.ok) {
      throw new ServiceError(kindForStatus(response.status), response.statusText, response.status);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  };

  return {
    get: (path, init = {}) => request(path, { ...init, method: "GET" }),
    post: (path, body, init = {}) =>
      request(path, {
        ...init,
        method: "POST",
        headers: { "content-type": "application/json", ...init.headers },
        body: JSON.stringify(body),
      }),
  };
}
