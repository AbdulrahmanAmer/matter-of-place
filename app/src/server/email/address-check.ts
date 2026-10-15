import { z } from "zod";
import { checkEmail, type EmailCheck, type MailHost } from "../../lib/email-check.ts";

// W9 item 1: the free part of the address check for the forms, run in the Worker. The domain's mail records come from
// DNS-over-HTTPS (a Worker has no resolver); the SMTP probe never runs here, it belongs to the laptop runner
// (`scripts/workforce/email-check.ts`). A slow or failed lookup answers `unknown` and never holds a form back.

const DOH = "https://cloudflare-dns.com/dns-query";
const TIMEOUT_MS = 1500;
const NOERROR = 0;
const NXDOMAIN = 3;
const TYPE = { A: 1, MX: 15, AAAA: 28 } as const;

// Only the fields read: the response code and the answers' type and data (`10 mx.example.com.` for an MX).
const dnsAnswer = z.object({
  Status: z.number(),
  Answer: z.array(z.object({ type: z.number(), data: z.string() })).optional(),
});

type DnsAnswer = z.infer<typeof dnsAnswer>;

/** The one call the lookup makes; a test passes its own. */
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

async function lookup(
  name: string,
  type: keyof typeof TYPE,
  fetchImpl: Fetch,
): Promise<DnsAnswer | "unknown"> {
  try {
    const response = await fetchImpl(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return "unknown";
    const parsed = dnsAnswer.safeParse(await response.json());
    return parsed.success ? parsed.data : "unknown";
  } catch {
    return "unknown";
  }
}

function records(answer: DnsAnswer, type: keyof typeof TYPE): DnsAnswer["Answer"] & object {
  return (answer.Answer ?? []).filter((record) => record.type === TYPE[type]);
}

/** Syntax, typo and mail records of an address over DNS-over-HTTPS; never throws, never probes the mailbox. */
export function checkAddressFree(
  address: string,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
): Promise<EmailCheck> {
  return checkEmail(address, {
    async mx(domain) {
      const answer = await lookup(domain, "MX", fetchImpl);
      if (answer === "unknown") return "unknown";
      if (answer.Status === NXDOMAIN) return null;
      if (answer.Status !== NOERROR) return "unknown";
      return records(answer, "MX").map((record): MailHost => {
        const [priority = "0", exchange = ""] = record.data.trim().split(/\s+/);
        return { priority: Number(priority), exchange };
      });
    },
    async hasAddress(domain) {
      for (const type of ["A", "AAAA"] as const) {
        const answer = await lookup(domain, type, fetchImpl);
        if (answer === "unknown" || answer.Status !== NOERROR) return "unknown";
        if (records(answer, type).length > 0) return true;
      }
      return false;
    },
  });
}
