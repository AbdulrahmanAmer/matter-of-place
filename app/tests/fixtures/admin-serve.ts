import { vi } from "vitest";

/**
 * The API of an admin screen for a component test: `fetch` answers each `METHOD path` from `answers` (a `Response` as
 * it is, anything else as JSON), refuses every other request with 404, and returns the requests it saw as
 * `METHOD path`, with the body appended for a write.
 */
export function serveAdmin(answers: Record<string, unknown>): string[] {
  const requested: string[] = [];
  vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${path}`;
    requested.push(typeof init.body === "string" ? `${key} ${init.body}` : key);
    const body = answers[key];
    if (body instanceof Response) return Promise.resolve(body);
    return Promise.resolve(
      body === undefined ? new Response("{}", { status: 404 }) : Response.json(body),
    );
  });
  return requested;
}
