import { z } from "zod";
import { ServiceError, type ServiceErrorKind } from "../types";

/**
 * Minimal JSON client for the Matter of Place API. Every body is parsed with the response schema
 * of the call, so a malformed answer is an error and never a value of the wrong shape. The API is same-origin in
 * production (Cloudflare Worker route `/api/*`), so no credentials or CORS
 * configuration are needed; a different origin works as long as it allows
 * the site's origin.
 */
export type ApiClient = {
  get<T>(path: string, shape: z.ZodType<T>, init?: RequestInit): Promise<T>;
  post<T>(path: string, body: unknown, shape: z.ZodType<T>, init?: RequestInit): Promise<T>;
};

/** A failed call, with the id the Worker logged it under so an error page can quote it (G33). */
export class HttpServiceError extends ServiceError {
  readonly requestId?: string;

  constructor(kind: ServiceErrorKind, message: string, status: number, requestId?: string) {
    super(kind, message, status);
    this.name = "HttpServiceError";
    if (requestId !== undefined) this.requestId = requestId;
  }
}

const errorBodySchema = z.object({ error: z.object({ requestId: z.string().optional() }) });

/** The `x-request-id` header, else the id in the error body; a body that is not JSON gives none. */
async function requestIdOf(response: Response): Promise<string | undefined> {
  const header = response.headers.get("x-request-id");
  if (header !== null) return header;
  try {
    const body = errorBodySchema.safeParse(await response.json());
    return body.success ? body.data.error.requestId : undefined;
  } catch {
    return undefined;
  }
}

const withHeaders = (defaults: Record<string, string>, extra: HeadersInit | undefined) => {
  const headers = new Headers(defaults);
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return headers;
};

const kindForStatus = (status: number) => {
  if (status === 404) return "not-found" as const;
  if (status === 410) return "gone" as const;
  if (status === 400 || status === 422) return "validation" as const;
  return "server" as const;
};

/** What the client needs of `fetch`, so a test or the server-side loader can pass its own. */
export type FetchImpl = (input: string, init: RequestInit) => Promise<Response>;

export function createApiClient(baseUrl: string, fetchImpl: FetchImpl = fetch): ApiClient {
  const request = async <T>(path: string, shape: z.ZodType<T>, init: RequestInit): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: withHeaders({ accept: "application/json" }, init.headers),
      });
    } catch (error) {
      throw new ServiceError("network", error instanceof Error ? error.message : "Network error");
    }
    if (!response.ok) {
      throw new HttpServiceError(
        kindForStatus(response.status),
        response.statusText,
        response.status,
        await requestIdOf(response),
      );
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
