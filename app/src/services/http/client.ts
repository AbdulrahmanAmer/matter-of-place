import { z } from "zod";
import { ServiceError, serviceIssues, type ServiceErrorKind, type ServiceIssue } from "../types";

/**
 * Minimal JSON client for the Matter of Place API. Every body is parsed with the response schema
 * of the call, so a malformed answer is an error and never a value of the wrong shape. The API is same-origin in
 * production (Cloudflare Worker route `/api/*`), so no credentials or CORS
 * configuration are needed; a different origin works as long as it allows
 * the site's origin.
 */
export type ApiClient = {
  get<T>(path: string, shape: z.ZodType<T, z.ZodTypeDef, unknown>, init?: RequestInit): Promise<T>;
  post<T>(
    path: string,
    body: unknown,
    shape: z.ZodType<T, z.ZodTypeDef, unknown>,
    init?: RequestInit,
  ): Promise<T>;
};

/** A failed call, with the id the Worker logged it under so an error page can quote it (G33). */
export class HttpServiceError extends ServiceError {
  readonly requestId?: string;

  constructor(
    kind: ServiceErrorKind,
    message: string,
    status: number,
    requestId?: string,
    issues?: readonly ServiceIssue[],
  ) {
    super(kind, message, status, issues);
    this.name = "HttpServiceError";
    if (requestId !== undefined) this.requestId = requestId;
  }
}

const errorBodySchema = z.object({
  error: z.object({
    requestId: z.string().optional(),
    issues: z.unknown(),
  }),
});

/**
 * What a failed answer says: the `x-request-id` header, else the id in the error body, and the refused fields of a
 * 400 or 422 (`error.issues`); a body that is not JSON gives neither.
 */
async function errorDetails(
  response: Response,
): Promise<{ requestId: string | undefined; issues: ServiceIssue[] }> {
  const header = response.headers.get("x-request-id");
  try {
    const body = errorBodySchema.safeParse(await response.json());
    return {
      requestId: header ?? (body.success ? body.data.error.requestId : undefined),
      issues: body.success ? serviceIssues(body.data.error.issues) : [],
    };
  } catch {
    return { requestId: header ?? undefined, issues: [] };
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
  const request = async <T>(
    path: string,
    shape: z.ZodType<T, z.ZodTypeDef, unknown>,
    init: RequestInit,
  ): Promise<T> => {
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
      const { requestId, issues } = await errorDetails(response);
      throw new HttpServiceError(
        kindForStatus(response.status),
        response.statusText,
        response.status,
        requestId,
        issues,
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
