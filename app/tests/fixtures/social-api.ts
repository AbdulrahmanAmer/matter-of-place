// The X and LinkedIn APIs for the B10 step 5a unit tests: the fixtures under tests/fixtures/x and tests/fixtures/linkedin,
// a fetch stub that answers by request and writes every request down, and a fakeDb with the Vault, settings and
// social.sql functions the adapters call. Nothing here reaches the network (R50).
import { readFileSync } from "node:fs";
import { vi } from "vitest";
import { z } from "zod";
import type { Json } from "../../src/db/index.ts";
import { fakeDb } from "./fake-db";

const fixtureFile = z
  .object({
    request: z.string(),
    status: z.number().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    response: z.unknown().optional(),
    responses: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export function platformFixture(provider: "x" | "linkedin", name: string) {
  const path = new URL(`./${provider}/${name}.json`, import.meta.url);
  return fixtureFile.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** A canned answer: bytes are sent as they are, anything else as JSON, `undefined` as an empty body. */
export class Answer {
  readonly body: unknown;
  readonly status: number;
  readonly headers: Record<string, string>;

  constructor(body: unknown, status = 200, headers: Record<string, string> = {}) {
    this.body = body;
    this.status = status;
    this.headers = headers;
  }
}

/** The fixture's answer: `response` or one of `responses`, with the fixture's status and headers. */
export function answerOf(provider: "x" | "linkedin", name: string, which?: string): Answer {
  const file = platformFixture(provider, name);
  const body = which === undefined ? file.response : file.responses?.[which];
  return new Answer(body, file.status ?? 200, file.headers ?? {});
}

/** `<METHOD> <url without its query>`, the form of a fixture's `request`. */
export const requestOf = (provider: "x" | "linkedin", name: string): string =>
  platformFixture(provider, name).request;

export interface SentRequest {
  key: string;
  url: URL;
  headers: Headers;
  body: RequestInit["body"];
}

/**
 * Answers by `<METHOD> <url without query>`: a list answers one per call and repeats its last answer, and a request
 * nobody registered throws. `sent` holds every request in order.
 */
export function stubPlatform(answers: Record<string, Answer | Answer[]>) {
  const queues = new Map(
    Object.entries(answers).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : [value],
    ]),
  );
  const sent: SentRequest[] = [];
  const spy = vi.fn((input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const key = `${init?.method ?? "GET"} ${url.origin}${url.pathname}`;
    sent.push({ key, url, headers: new Headers(init?.headers), body: init?.body });
    const queue = queues.get(key);
    if (queue === undefined) throw new Error(`unexpected ${key}`);
    const answer = queue.length > 1 ? queue.shift() : queue[0];
    if (answer === undefined) throw new Error(`no answer for ${key}`);
    const body =
      answer.body instanceof Uint8Array
        ? new Uint8Array(answer.body)
        : answer.body === undefined
          ? null
          : JSON.stringify(answer.body);
    return Promise.resolve(new Response(body, { status: answer.status, headers: answer.headers }));
  });
  vi.stubGlobal("fetch", spy);
  return { sent, spy, calls: () => sent.map((request) => request.key) };
}

export interface SocialDbOptions {
  /** The Vault value of `<channel>_oauth_token`: a token set, or null for an empty entry. */
  vault?: Json | Json[];
  settings?: { key: "x" | "linkedin"; value: NonNullable<Json> };
  /** What `store_channel_token` answers. */
  store?: "stored" | "busy" | "stale";
}

/**
 * fakeDb with `get_vault_secret` (a list answers one per call and repeats its last), the `settings` row, and the
 * social.sql functions, which answer `store` or nothing.
 */
export function socialDb(options: SocialDbOptions = {}) {
  const vault = Array.isArray(options.vault) ? [...options.vault] : [options.vault ?? null];
  const readVault = () => {
    const value = vault.length > 1 ? vault.shift() : vault[0];
    return value === null || value === undefined ? "" : JSON.stringify(value);
  };
  // social.sql's functions join the generated types with step 6, so the handlers go in as a variable.
  const rpc = {
    get_vault_secret: readVault,
    // A stored set is what Vault answers from then on, as the real function's write makes it.
    store_channel_token: (args: { p_token_set: Json }) => {
      const answer = options.store ?? "stored";
      if (answer === "stored") vault.splice(0, vault.length, args.p_token_set);
      return answer;
    },
    record_channel_check: () => undefined,
    record_channel_usage: () => 1,
    enqueue_job: () => "3f2a9c1d-0000-4000-8000-0000000000dd",
  };
  const settings = options.settings === undefined ? [] : [options.settings];
  const tables = {
    settings: settings.map(({ key, value }) => ({
      key,
      value,
      updated_at: "2026-10-04T00:00:00Z",
      updated_by: null,
    })),
  };
  return fakeDb({ rpc, tables });
}

/** The arguments of every call of `name`, in order. */
export function rpcArgs(db: ReturnType<typeof socialDb>, name: string): unknown[] {
  return db.calls
    .filter((call) => call.kind === "rpc" && call.name === name)
    .map((call) => call.args[0]);
}
