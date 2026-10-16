// W8 0h (operator, 2026-10-16): the reports services mail us about our own domain, read into counts. A DMARC aggregate
// report (a zip or a gzip of XML) and an SMTP TLS report (a gzip of JSON) are parsed with hard limits: at most
// MAX_COMPRESSED bytes in, MAX_EXPANDED bytes out (zlib's own output cap, which Bun and Node both honour, measured
// 2026-10-16), MAX_RECORDS records, no DTD, no entity, nothing fetched. A report past a limit, or one that is not what it
// says, is unparsed, never half-read. Only counts, our own domains, source IPs and the reporting organisation leave this
// file; no free text from inside a report reaches a summary. CRITICAL (outside data).
import { isIP } from "node:net";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { z } from "zod";

export const MAX_COMPRESSED = 1024 * 1024;
export const MAX_EXPANDED = 4 * 1024 * 1024;
export const MAX_RECORDS = 2000;
const MAX_ZIP_ENTRIES = 4;

/** The domains a report may be about; anything else is named "another domain". */
export const OUR_DOMAINS = ["matterofplace.com", "notify.matterofplace.com"] as const;

export type SourceCount = {
  ip: string;
  messages: number;
  dkimPass: number;
  dkimFail: number;
  spfPass: number;
  spfFail: number;
  /** Messages the receiver quarantined or rejected. */
  acted: number;
};

export type DmarcReport = {
  kind: "dmarc";
  org: string;
  domain: string;
  records: number;
  messages: number;
  dkimPass: number;
  dkimFail: number;
  spfPass: number;
  spfFail: number;
  acted: number;
  sources: SourceCount[];
  /** A record whose DKIM or SPF did not pass and which the receiver did not leave alone (disposition other than none). */
  failed: boolean;
};

export type TlsReport = {
  kind: "tls";
  org: string;
  domains: string[];
  successful: number;
  failed: number;
  failures: { type: string; ip: string; sessions: number }[];
};

export type Report = DmarcReport | TlsReport;

/** Why a report was not read; recorded beside the message, never a reason to drop it. */
export type Unparsed = { kind: "unparsed"; reason: string };

class Refused extends Error {}

// ---------- decompression with limits ----------

/** Expands at most MAX_EXPANDED bytes; zlib throws past the cap, and that is a refusal, not a crash. */
function capped(expand: () => Buffer): Buffer {
  try {
    return expand();
  } catch {
    throw new Refused("it expands past the limit or is not compressed data");
  }
}

/** The first entry of a zip whose name ends in `.xml` (stored or deflated), read from its central directory. */
export function unzipFirstXml(zip: Buffer): Buffer {
  if (zip.length > MAX_COMPRESSED) throw new Refused("the file is larger than the limit");
  // End of central directory: the last 22 bytes, or earlier when the zip carries a comment (at most 64 KiB).
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 65_535); at -= 1) {
    if (zip.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Refused("it is not a zip");
  const entries = zip.readUInt16LE(end + 10);
  if (entries === 0 || entries > MAX_ZIP_ENTRIES) throw new Refused("the zip holds too many files");
  let at = zip.readUInt32LE(end + 16);
  for (let index = 0; index < entries; index += 1) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== 0x02014b50)
      throw new Refused("the zip is damaged");
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("latin1", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (!/\.xml$/i.test(name)) continue;
    // Encrypted entries and zip64 sizes are refused, not guessed at.
    if ((flags & 1) !== 0 || size === 0xffffffff) throw new Refused("the zip entry is not plain");
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50)
      throw new Refused("the zip is damaged");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (data.length !== size) throw new Refused("the zip is damaged");
    if (method === 0) {
      if (size > MAX_EXPANDED) throw new Refused("it expands past the limit");
      return data;
    }
    if (method !== 8) throw new Refused("the zip uses an unknown compression");
    return capped(() => inflateRawSync(data, { maxOutputLength: MAX_EXPANDED }));
  }
  throw new Refused("the zip holds no report");
}

/** A gzip's content, at most MAX_EXPANDED bytes. */
export function gunzipCapped(file: Buffer): Buffer {
  if (file.length > MAX_COMPRESSED) throw new Refused("the file is larger than the limit");
  return capped(() => gunzipSync(file, { maxOutputLength: MAX_EXPANDED }));
}

// ---------- DMARC aggregate (RFC 7489 appendix C) ----------

const ORG = /^[A-Za-z0-9][A-Za-z0-9 .,&()'-]{0,79}$/;

/** A reporting organisation as we name it: its own words only when they are a plain name, else "unknown". */
function orgName(value: string | undefined): string {
  const text = (value ?? "").trim();
  return ORG.test(text) ? text : "unknown";
}

function ourDomain(value: string | undefined): string {
  const text = (value ?? "").trim().toLowerCase();
  return (OUR_DOMAINS as readonly string[]).includes(text) ? text : "another domain";
}

/** The text of the first `<name>` element inside `xml`, or undefined. */
function tag(xml: string, name: string): string | undefined {
  const found = new RegExp(`<${name}>([^<]{0,300})</${name}>`).exec(xml);
  return found?.[1];
}

function count(value: string | undefined): number {
  const text = (value ?? "").trim();
  if (!/^\d{1,9}$/.test(text)) throw new Refused("a count is not a number");
  return Number(text);
}

function verdict(value: string | undefined): "pass" | "fail" {
  return (value ?? "").trim().toLowerCase() === "pass" ? "pass" : "fail";
}

export function parseDmarc(xmlBytes: Buffer): DmarcReport {
  const xml = xmlBytes.toString("utf8");
  // No DTD, no entity, no processing instruction past the declaration, no CDATA: a report needs none of them.
  if (/<!/.test(xml) || /<\?(?!xml\s)/.test(xml) || /&(?!(amp|lt|gt|quot|apos);)/.test(xml))
    throw new Refused("it carries a DTD, an entity or markup a report never has");
  if (!/<feedback[\s>]/.test(xml)) throw new Refused("it is not a DMARC report");
  const records = xml.match(/<record>[\s\S]*?<\/record>/g) ?? [];
  if (records.length === 0) throw new Refused("it holds no record");
  if (records.length > MAX_RECORDS) throw new Refused("it holds too many records");
  const bySource = new Map<string, SourceCount>();
  let failed = false;
  for (const record of records) {
    const ip = (tag(record, "source_ip") ?? "").trim();
    if (isIP(ip) === 0) throw new Refused("a source is not an IP address");
    const messages = count(tag(record, "count"));
    const disposition = (tag(record, "disposition") ?? "").trim().toLowerCase();
    if (!["none", "quarantine", "reject"].includes(disposition))
      throw new Refused("a disposition is not one DMARC knows");
    const dkim = verdict(tag(record, "dkim"));
    const spf = verdict(tag(record, "spf"));
    const row = bySource.get(ip) ?? {
      ip,
      messages: 0,
      dkimPass: 0,
      dkimFail: 0,
      spfPass: 0,
      spfFail: 0,
      acted: 0,
    };
    row.messages += messages;
    row[dkim === "pass" ? "dkimPass" : "dkimFail"] += messages;
    row[spf === "pass" ? "spfPass" : "spfFail"] += messages;
    if (disposition !== "none") row.acted += messages;
    bySource.set(ip, row);
    if ((dkim !== "pass" || spf !== "pass") && disposition !== "none") failed = true;
  }
  const sources = [...bySource.values()];
  const sum = (key: keyof Omit<SourceCount, "ip">) =>
    sources.reduce((total, row) => total + row[key], 0);
  const domain = ourDomain(tag(xml, "domain"));
  return {
    kind: "dmarc",
    org: orgName(tag(xml, "org_name")),
    domain,
    records: records.length,
    messages: sum("messages"),
    dkimPass: sum("dkimPass"),
    dkimFail: sum("dkimFail"),
    spfPass: sum("spfPass"),
    spfFail: sum("spfFail"),
    acted: sum("acted"),
    sources,
    failed,
  };
}

// ---------- SMTP TLS reporting (RFC 8460) ----------

const tlsSchema = z.object({
  "organization-name": z.string().max(200).optional(),
  policies: z
    .array(
      z.object({
        policy: z.object({ "policy-domain": z.string().max(253) }).passthrough(),
        summary: z.object({
          "total-successful-session-count": z.number().int().min(0),
          "total-failure-session-count": z.number().int().min(0),
        }),
        "failure-details": z
          .array(
            z
              .object({
                "result-type": z.string().max(100),
                "sending-mta-ip": z.string().max(64).optional(),
                "failed-session-count": z.number().int().min(0),
              })
              .passthrough(),
          )
          .max(MAX_RECORDS)
          .optional(),
      }),
    )
    .min(1)
    .max(100),
});

export function parseTls(jsonBytes: Buffer): TlsReport {
  let value: unknown;
  try {
    value = JSON.parse(jsonBytes.toString("utf8"));
  } catch {
    throw new Refused("it is not JSON");
  }
  const parsed = tlsSchema.safeParse(value);
  if (!parsed.success) throw new Refused("it is not a TLS report");
  const { policies } = parsed.data;
  const failures = policies.flatMap((policy) =>
    (policy["failure-details"] ?? []).map((detail) => {
      const type = detail["result-type"].trim().toLowerCase();
      const ip = (detail["sending-mta-ip"] ?? "").trim();
      return {
        type: /^[a-z0-9-]{1,60}$/.test(type) ? type : "unknown",
        ip: isIP(ip) === 0 ? "unknown" : ip,
        sessions: detail["failed-session-count"],
      };
    }),
  );
  const domains = [...new Set(policies.map((policy) => ourDomain(policy.policy["policy-domain"])))];
  return {
    kind: "tls",
    org: orgName(parsed.data["organization-name"]),
    domains,
    successful: policies.reduce(
      (total, policy) => total + policy.summary["total-successful-session-count"],
      0,
    ),
    failed: policies.reduce(
      (total, policy) => total + policy.summary["total-failure-session-count"],
      0,
    ),
    failures,
  };
}

// ---------- one attachment ----------

/** Whether an attachment's name says it is a report this file reads. */
export function isReportName(name: string): boolean {
  return /\.(zip|xml|gz)$/i.test(name);
}

/** One report attachment, read with every limit; anything that fails a limit or a shape is unparsed. */
export function readReport(name: string, file: Buffer): Report | Unparsed {
  try {
    if (file.length > MAX_COMPRESSED) throw new Refused("the file is larger than the limit");
    const lower = name.toLowerCase();
    const bytes = lower.endsWith(".zip")
      ? unzipFirstXml(file)
      : lower.endsWith(".gz")
        ? gunzipCapped(file)
        : file;
    if (bytes.length > MAX_EXPANDED) throw new Refused("it expands past the limit");
    const head = bytes.subarray(0, 64).toString("utf8").trimStart();
    return head.startsWith("{") ? parseTls(bytes) : parseDmarc(bytes);
  } catch (failure: unknown) {
    if (failure instanceof Refused) return { kind: "unparsed", reason: failure.message };
    return { kind: "unparsed", reason: "it could not be read" };
  }
}

/** Whether a report says something failed (Matter is woken only then). An unparsed report is not a pass. */
export function reportFailed(report: Report | Unparsed): boolean {
  if (report.kind === "unparsed") return true;
  return report.kind === "dmarc" ? report.failed : report.failed > 0;
}

/** The report in fixed words and numbers: no text from inside the report but the checked names above. */
export function reportSummary(report: Report | Unparsed): string {
  if (report.kind === "unparsed") return `A report that could not be read: ${report.reason}.`;
  if (report.kind === "dmarc") {
    const failing = report.sources.filter((row) => row.dkimFail + row.spfFail > 0);
    return [
      `DMARC report from ${report.org} for ${report.domain}: ${String(report.messages)} messages in ${String(report.records)} records.`,
      `DKIM pass ${String(report.dkimPass)}, fail ${String(report.dkimFail)}; SPF pass ${String(report.spfPass)}, fail ${String(report.spfFail)}; quarantined or rejected ${String(report.acted)}.`,
      ...(failing.length === 0
        ? []
        : [
            `Sources that did not pass: ${failing
              .slice(0, 10)
              .map(
                (row) =>
                  `${row.ip} (${String(row.messages)} messages, DKIM fail ${String(row.dkimFail)}, SPF fail ${String(row.spfFail)}, acted on ${String(row.acted)})`,
              )
              .join("; ")}.`,
          ]),
    ].join(" ");
  }
  const types = new Map<string, number>();
  for (const failure of report.failures)
    types.set(failure.type, (types.get(failure.type) ?? 0) + failure.sessions);
  return [
    `TLS report from ${report.org} for ${report.domains.join(", ")}: ${String(report.successful)} sessions successful, ${String(report.failed)} failed.`,
    ...(types.size === 0
      ? []
      : [
          `Failure types: ${[...types]
            .slice(0, 10)
            .map(([type, sessions]) => `${type} ${String(sessions)}`)
            .join(", ")}.`,
        ]),
  ].join(" ");
}
