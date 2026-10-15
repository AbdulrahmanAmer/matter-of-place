// W9 item 1 (operator, 2026-10-15: "check if the emails actually exist before we send"): one rule for an address,
// shared by the forms (syntax, a typo domain, the domain's mail records), the server (the same, over DNS-over-HTTPS)
// and the laptop runner (the same, over the system resolver, plus an SMTP probe where port 25 is open). Pure: the
// resolver and the probe are passed in, so the rule is tested without a network.

/** What is known about an address before anything is sent to it. */
type EmailVerdict = "ok" | "domain_has_no_mail" | "mailbox_refused" | "unknown";

/** One mail host of a domain, as DNS lists it. */
export interface MailHost {
  exchange: string;
  priority: number;
}

export interface EmailCheckDeps {
  /** The domain's MX hosts: `[]` when it has none, `null` when the name does not exist, `"unknown"` when DNS did not answer. */
  mx(domain: string): Promise<readonly MailHost[] | null | "unknown">;
  /** Whether the domain has an address record (RFC 5321 5.1: with no MX, mail goes to the domain itself). */
  hasAddress(domain: string): Promise<boolean | "unknown">;
  /** Asks the first mail host whether it takes mail for the address (never DATA); left out where port 25 is closed. */
  probe?(host: string, address: string): Promise<"accepted" | "refused" | "unknown">;
}

export interface EmailCheck {
  verdict: EmailVerdict;
  /** The address with a common typo of its domain fixed, when the domain looks like one. */
  suggestion: string | null;
  /** One plain sentence on why. */
  reason: string;
}

// The misspellings people make of the providers most of our submitters and readers use.
const typoDomains: Readonly<Record<string, string>> = {
  "gmial.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmail.co": "gmail.com",
  "googlemail.co": "googlemail.com",
  "hotmial.com": "hotmail.com",
  "hotmal.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotamil.com": "hotmail.com",
  "homail.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yhoo.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "outlok.com": "outlook.com",
  "outllok.com": "outlook.com",
  "outlook.co": "outlook.com",
  "iclod.com": "icloud.com",
  "icoud.com": "icloud.com",
  "iclould.com": "icloud.com",
  "icloud.co": "icloud.com",
  "aol.co": "aol.com",
  "comcast.ent": "comcast.net",
  "sbcglobal.ent": "sbcglobal.net",
};

// A top-level domain no one owns that is one key away from `.com` or `.net`.
const typoEndings: Readonly<Record<string, string>> = {
  con: "com",
  cmo: "com",
  ocm: "com",
  vom: "com",
  xom: "com",
  cpm: "com",
  comm: "com",
  coom: "com",
  nte: "net",
  nett: "net",
};

const LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The address split at its last `@`, the domain lower-cased; null when it is not shaped like an address. */
function parts(address: string): { local: string; domain: string } | null {
  const trimmed = address.trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || trimmed.length > 254) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (!LOCAL.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes(".."))
    return null;
  const labels = domain.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  if (!/^[a-z]{2,}$/.test(labels.at(-1) ?? "")) return null;
  return { local, domain };
}

/** The address with its domain's typo fixed (`ann@gmial.com` → `ann@gmail.com`), or null when nothing looks wrong. */
export function suggestAddress(address: string): string | null {
  const split = parts(address);
  if (split === null) return null;
  const known = typoDomains[split.domain];
  if (known !== undefined) return `${split.local}@${known}`;
  const dot = split.domain.lastIndexOf(".");
  const ending = typoEndings[split.domain.slice(dot + 1)];
  return ending === undefined ? null : `${split.local}@${split.domain.slice(0, dot)}.${ending}`;
}

/** The verdict for one address: syntax, typo, mail records, then the probe when one is given. Never throws. */
export async function checkEmail(address: string, deps: EmailCheckDeps): Promise<EmailCheck> {
  const split = parts(address);
  if (split === null)
    return {
      verdict: "domain_has_no_mail",
      suggestion: null,
      reason: "This is not an email address.",
    };
  const suggestion = suggestAddress(address);
  const typo = suggestion === null ? "" : ` Did you mean ${suggestion}?`;
  const hosts = await deps.mx(split.domain).catch(() => "unknown" as const);
  if (hosts === "unknown")
    return {
      verdict: "unknown",
      suggestion,
      reason: `The mail records of ${split.domain} could not be read.${typo}`,
    };
  // A null MX (RFC 7505: one record, exchange ".") says the domain takes no mail at all.
  const usable = (hosts ?? []).filter((host) => host.exchange.replace(/\.$/, "") !== "");
  if (hosts === null || (hosts.length > 0 && usable.length === 0))
    return {
      verdict: "domain_has_no_mail",
      suggestion,
      reason: `${split.domain} does not receive email.${typo}`,
    };
  if (usable.length === 0) {
    const direct = await deps.hasAddress(split.domain).catch(() => "unknown" as const);
    if (direct === "unknown")
      return {
        verdict: "unknown",
        suggestion,
        reason: `The records of ${split.domain} could not be read.${typo}`,
      };
    if (!direct)
      return {
        verdict: "domain_has_no_mail",
        suggestion,
        reason: `${split.domain} does not receive email.${typo}`,
      };
  }
  if (deps.probe === undefined)
    return { verdict: "ok", suggestion, reason: `${split.domain} receives email.${typo}` };
  const first = [...usable].sort((a, b) => a.priority - b.priority)[0]?.exchange ?? split.domain;
  const answer = await deps
    .probe(first.replace(/\.$/, ""), address.trim())
    .catch(() => "unknown" as const);
  if (answer === "refused")
    return {
      verdict: "mailbox_refused",
      suggestion,
      reason: `The mail server of ${split.domain} says this mailbox does not exist.${typo}`,
    };
  if (answer === "unknown")
    return {
      verdict: "unknown",
      suggestion,
      reason: `${split.domain} receives email; whether this mailbox exists could not be asked.${typo}`,
    };
  return {
    verdict: "ok",
    suggestion,
    reason: `The mail server of ${split.domain} takes mail for this address.${typo}`,
  };
}
