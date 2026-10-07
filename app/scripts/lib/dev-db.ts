// The service-role calls of the social scripts against the one project (ruling H35), through PostgREST. The
// generated types do not list the functions and tables of `social.sql` until it is merged and `gen:types` has run,
// so every answer is parsed with the schema the caller passes.
import { z } from "zod";
import { devProject } from "./storage-env.ts";

const TIMEOUT_MS = 20_000;
const failure = z.object({ message: z.string().optional() });

export interface DevDb {
  rpc<T>(name: string, args: Record<string, unknown>, answer: z.ZodType<T>): Promise<T>;
  select<T>(table: string, query: string, rows: z.ZodType<T>): Promise<T>;
}

/** The client for `DEV_SUPABASE_PROJECT_REF` and `DEV_SUPABASE_SERVICE_ROLE_KEY`, which the dev profile loads. */
export function devDb(): DevDb {
  const { url, key } = devProject();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  async function call<T>(path: string, init: RequestInit, answer: z.ZodType<T>): Promise<T> {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = failure.safeParse(body).data?.message ?? response.statusText;
      throw new Error(
        `database ${path.split("?")[0] ?? path} answered ${String(response.status)}: ${message}`,
      );
    }
    return answer.parse(body);
  }

  return {
    rpc: (name, args, answer) =>
      call(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) }, answer),
    select: (table, query, rows) => call(`${table}?${query}`, { method: "GET" }, rows),
  };
}
