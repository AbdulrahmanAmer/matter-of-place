import { z } from "zod";
import { ServiceError } from "../types";

/**
 * Minimal JSON client for the Matter of Place API. The API is same-origin in
 * production (Cloudflare Worker route `/api/*`), so no credentials or CORS
 * configuration are needed; a different origin works as long as it allows
 * the site's origin.
 */
export type ApiClient = {
  get<T>(path: string, shape: z.ZodType<T>, init?: RequestInit): Promise<T>;
  post<T>(path: string, body: unknown, shape: z.ZodType<T>, init?: RequestInit): Promise<T>;
};

/**
 * The response shape the API contract promises. The contract is not re-validated in the browser
 * (ADR 0002); this names the one place where the body is trusted.
 */
export const trusted = <T>() => z.custom<T>();

const withHeaders = (defaults: Record<string, string>, extra: HeadersInit | undefined) => {
  const headers = new Headers(defaults);
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return headers;
};

const kindForStatus = (status: number) => {
  if (status === 404) return "not-found" as const;
  if (status === 400 || status === 422) return "validation" as const;
  return "server" as const;
};

export function createApiClient(baseUrl: string): ApiClient {
  const request = async <T>(path: string, shape: z.ZodType<T>, init: RequestInit): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: withHeaders({ accept: "application/json" }, init.headers),
      });
    } catch (error) {
      throw new ServiceError("network", error instanceof Error ? error.message : "Network error");
    }
    if (!response.ok) {
      throw new ServiceError(kindForStatus(response.status), response.statusText, response.status);
    }
    return shape.parse(response.status === 204 ? undefined : await response.json());
  };

  return {
    get: (path, shape, init = {}) => request(path, shape, { ...init, method: "GET" }),
    post: (path, body, shape, init = {}) =>
      request(path, shape, {
        ...init,
        method: "POST",
        headers: withHeaders({ "content-type": "application/json" }, init.headers),
        body: JSON.stringify(body),
      }),
  };
}
