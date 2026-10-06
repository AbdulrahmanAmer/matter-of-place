import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkDomains } from "../../../scripts/resend-check";
import {
  listDomains,
  RESEND_DOMAINS,
  setupDomains,
  type Fetch,
  type Io,
  type SetupKeys,
} from "../../../scripts/resend-domain";

interface Call {
  method: string;
  url: URL;
  body: Record<string, unknown> | null;
}

const bodyOf = z.record(z.string(), z.unknown());

const reply = (body: unknown): Response => Response.json(body);

/** A fetch stub: `answer` returns the body for a call, or undefined for a call nobody expected, which throws. */
function stub(answer: (call: Call) => unknown): { io: Io; calls: Call[]; lines: string[] } {
  const calls: Call[] = [];
  const lines: string[] = [];
  const fetchStub: Fetch = (url, init) => {
    const call: Call = {
      method: init.method ?? "GET",
      url: new URL(url),
      body: typeof init.body === "string" ? bodyOf.parse(JSON.parse(init.body)) : null,
    };
    calls.push(call);
    const body = answer(call);
    if (body === undefined) throw new Error(`unexpected call ${call.method} ${call.url.href}`);
    return Promise.resolve(reply(body));
  };
  return { io: { fetch: fetchStub, log: (line) => lines.push(line) }, calls, lines };
}

const listOf = (status: Record<string, string>): { data: unknown[] } => ({
  data: Object.entries(status).map(([name, state]) => ({
    id: `id-${name}`,
    name,
    status: state,
  })),
});

const record = (kind: string, type: string, name: string, status = "verified"): unknown => ({
  record: kind,
  name,
  type,
  value: `value of ${name}`,
  status,
  ttl: "Auto",
  ...(type === "MX" ? { priority: 10 } : {}),
});

const notesRecords = [
  record("DKIM", "TXT", "resend._domainkey.notes", "not_started"),
  record("SPF", "MX", "send.notes", "not_started"),
  record("SPF", "TXT", "send.notes", "not_started"),
  record("SPF", "CNAME", "rsend.notes", "not_started"),
];

const allVerified = Object.fromEntries(RESEND_DOMAINS.map((name) => [name, "verified"]));

const keys = (cloudflare: () => string): SetupKeys => ({ resend: "re_key", cloudflare });
const noToken = keys(() => {
  throw new Error("the Cloudflare token was asked for");
});

const isCloudflare = (call: Call): boolean => call.url.host === "api.cloudflare.com";
const path = (call: Call): string => `${call.method} ${call.url.pathname}`;

/** An account missing `notes.matterofplace.com`, with a Cloudflare zone whose `type name` records `existing` lists. */
function missingNotes(existing: readonly string[] = []): ReturnType<typeof stub> {
  return stub((call) => {
    const resendPath = path(call);
    if (resendPath === "GET /domains") {
      return listOf({
        "matterofplace.com": "verified",
        "notify.matterofplace.com": "verified",
      });
    }
    if (resendPath === "POST /domains") {
      return {
        id: "id-notes",
        name: "notes.matterofplace.com",
        status: "not_started",
        records: notesRecords,
      };
    }
    if (resendPath === "POST /domains/id-notes/verify") return { object: "domain", id: "id-notes" };
    if (resendPath === "GET /client/v4/zones") return { result: [{ id: "zone-1" }] };
    if (resendPath === "GET /client/v4/zones/zone-1/dns_records") {
      const kind = `${call.url.searchParams.get("type") ?? ""} ${call.url.searchParams.get("name") ?? ""}`;
      return { result: existing.includes(kind) ? [{ id: "rec-old" }] : [] };
    }
    if (call.method === "POST" && resendPath === "POST /client/v4/zones/zone-1/dns_records") {
      return { result: { id: "rec-new" } };
    }
    if (resendPath === "PUT /client/v4/zones/zone-1/dns_records/rec-old") {
      return { result: { id: "rec-old" } };
    }
    return undefined;
  });
}

describe("resend-domain", () => {
  it("verified domain makes one GET and nothing else", async () => {
    const { io, calls, lines } = stub((call) =>
      path(call) === "GET /domains" ? listOf(allVerified) : undefined,
    );
    await setupDomains(io, noToken);
    expect(calls.map(path)).toEqual(["GET /domains"]);
    expect(lines).toEqual([
      "domain matterofplace.com verified (no change)",
      "domain notify.matterofplace.com verified (no change)",
      "domain notes.matterofplace.com verified (no change)",
    ]);
  });

  it("a missing domain is created alone, its records written in Cloudflare, then verified", async () => {
    const { io, calls, lines } = missingNotes();
    await setupDomains(
      io,
      keys(() => "cf_token"),
    );
    const created = calls.filter((call) => path(call) === "POST /domains");
    expect(created.map((call) => call.body)).toEqual([
      { name: "notes.matterofplace.com", region: "us-east-1" },
    ]);
    const written = calls.filter((call) => isCloudflare(call) && call.method === "POST");
    expect(written.map((call) => call.body)).toEqual([
      {
        type: "TXT",
        name: "resend._domainkey.notes.matterofplace.com",
        content: "value of resend._domainkey.notes",
        ttl: 1,
        proxied: false,
      },
      {
        type: "MX",
        name: "send.notes.matterofplace.com",
        content: "value of send.notes",
        ttl: 1,
        proxied: false,
        priority: 10,
      },
      {
        type: "TXT",
        name: "send.notes.matterofplace.com",
        content: "value of send.notes",
        ttl: 1,
        proxied: false,
      },
      {
        type: "CNAME",
        name: "rsend.notes.matterofplace.com",
        content: "value of rsend.notes",
        ttl: 1,
        proxied: false,
      },
    ]);
    expect(calls.map(path).at(-1)).toBe("POST /domains/id-notes/verify");
    expect(lines).toContain("record MX send.notes.matterofplace.com ok");
  });

  it("a record already in the zone is updated in place, not added twice", async () => {
    const { io, calls } = missingNotes(["MX send.notes.matterofplace.com"]);
    await setupDomains(
      io,
      keys(() => "cf_token"),
    );
    const updated = calls.filter((call) => call.method === "PUT");
    expect(updated.map((call) => call.body?.["type"])).toEqual(["MX"]);
    expect(calls.filter((call) => isCloudflare(call) && call.method === "POST")).toHaveLength(3);
  });

  it("a listed domain that is not verified is read and verified, never created", async () => {
    const { io, calls } = stub((call) => {
      const route = path(call);
      if (route === "GET /domains")
        return listOf({ ...allVerified, "notes.matterofplace.com": "pending" });
      if (route === "GET /domains/id-notes.matterofplace.com") {
        return { id: "id-notes", name: "notes.matterofplace.com", status: "pending", records: [] };
      }
      if (route === "GET /client/v4/zones") return { result: [{ id: "zone-1" }] };
      if (route === "POST /domains/id-notes/verify") return { object: "domain" };
      return undefined;
    });
    await setupDomains(
      io,
      keys(() => "cf_token"),
    );
    expect(calls.map(path)).not.toContain("POST /domains");
    expect(calls.map(path)).toContain("POST /domains/id-notes/verify");
  });

  it("a record at the apex is refused and nothing is written to Cloudflare", async () => {
    const { io, calls } = stub((call) => {
      const route = path(call);
      if (route === "GET /domains")
        return listOf({ ...allVerified, "notes.matterofplace.com": "pending" });
      if (route === "GET /domains/id-notes.matterofplace.com") {
        return {
          id: "id-notes",
          name: "notes.matterofplace.com",
          status: "pending",
          records: [record("SPF", "TXT", "@")],
        };
      }
      if (route === "GET /client/v4/zones") return { result: [{ id: "zone-1" }] };
      return undefined;
    });
    await expect(
      setupDomains(
        io,
        keys(() => "cf_token"),
      ),
    ).rejects.toThrow(/apex of matterofplace.com/);
    expect(calls.filter((call) => isCloudflare(call) && call.method !== "GET")).toEqual([]);
  });

  it("a dropped connection is retried and the answer of the third try is used", async () => {
    let tries = 0;
    const io: Io = {
      fetch: () => {
        tries += 1;
        return tries < 3
          ? Promise.reject(new Error("connect ETIMEDOUT"))
          : Promise.resolve(reply(listOf(allVerified)));
      },
      log: () => undefined,
    };
    const domains = await listDomains(io, "re_key");
    expect(tries).toBe(3);
    expect(domains.map((domain) => domain.name).sort()).toEqual([...RESEND_DOMAINS].sort());
  });

  it("a refusal is not retried and names the status", async () => {
    let tries = 0;
    const io: Io = {
      fetch: () => {
        tries += 1;
        return Promise.resolve(Response.json({ name: "restricted_api_key" }, { status: 401 }));
      },
      log: () => undefined,
    };
    await expect(listDomains(io, "re_key")).rejects.toThrow(/401 .*restricted_api_key/);
    expect(tries).toBe(1);
  });
});

describe("resend-check", () => {
  const detail = (name: string, status: string, records: unknown[]): unknown => ({
    id: `id-${name}`,
    name,
    status,
    records,
  });
  const goodRecords = [record("DKIM", "TXT", "resend._domainkey"), record("SPF", "TXT", "send")];
  const account = (status: Record<string, string>, records: unknown[] = goodRecords) =>
    stub((call) => {
      if (path(call) === "GET /domains") return listOf(status);
      const name = /^\/domains\/id-(.+)$/.exec(call.url.pathname)?.[1];
      return name === undefined ? undefined : detail(name, "verified", records);
    });

  it("prints verified, spf pass and dkim pass for each domain and exits 0", async () => {
    const { io, lines } = account(allVerified);
    expect(await checkDomains(io, "re_key")).toBe(0);
    expect(lines).toEqual(
      RESEND_DOMAINS.flatMap((name) => [`domain ${name} verified`, "spf pass", "dkim pass"]),
    );
  });

  it("exits non-zero naming a domain listed as pending", async () => {
    const { io, lines } = account({ ...allVerified, "notes.matterofplace.com": "pending" });
    expect(await checkDomains(io, "re_key")).toBe(1);
    expect(lines).toContain("domain notes.matterofplace.com not verified (pending)");
  });

  it("exits non-zero naming a domain the account does not list", async () => {
    const { io, lines } = account({ "matterofplace.com": "verified" });
    expect(await checkDomains(io, "re_key")).toBe(1);
    expect(lines).toContain("domain notify.matterofplace.com missing");
    expect(lines).toContain("domain notes.matterofplace.com missing");
  });

  it("a verified domain whose SPF record is not verified fails spf", async () => {
    const { io, lines } = account(allVerified, [
      record("DKIM", "TXT", "resend._domainkey"),
      record("SPF", "TXT", "send", "failed"),
    ]);
    expect(await checkDomains(io, "re_key")).toBe(1);
    expect(lines).toContain("spf fail");
    expect(lines).toContain("dkim pass");
  });
});
