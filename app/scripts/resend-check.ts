// B5 step 5: reads the three Resend sending domains and says whether each is verified, with its SPF and DKIM records.
// From the app folder: `bun run scripts/resend-check.ts`. It only reads: one list, then one read of each verified
// domain for the status of its records. B11 and L1 run this same script. Exit 1 names every domain that is missing
// or not verified, and `BLOCKED: no RESEND_API_KEY` stands when the key is absent.
import {
  listDomains,
  readDomain,
  readResendKey,
  RESEND_DOMAINS,
  type DomainDetail,
  type Io,
} from "./resend-domain.ts";

const passes = (detail: DomainDetail, record: "SPF" | "DKIM"): boolean => {
  const own = detail.records.filter((entry) => entry.record === record);
  return own.length > 0 && own.every((entry) => entry.status === "verified");
};

/** Prints one block per domain and returns the exit code: 0 when all three are verified with SPF and DKIM passing. */
export async function checkDomains(io: Io, key: string): Promise<number> {
  const listed = await listDomains(io, key);
  let failed = false;
  for (const name of RESEND_DOMAINS) {
    const known = listed.find((domain) => domain.name === name);
    if (known === undefined) {
      io.log(`domain ${name} missing`);
      failed = true;
      continue;
    }
    if (known.status !== "verified") {
      io.log(`domain ${name} not verified (${known.status})`);
      failed = true;
      continue;
    }
    io.log(`domain ${name} verified`);
    const detail = await readDomain(io, key, known.id);
    for (const [label, record] of [
      ["spf", "SPF"],
      ["dkim", "DKIM"],
    ] as const) {
      const pass = passes(detail, record);
      io.log(`${label} ${pass ? "pass" : "fail"}`);
      failed ||= !pass;
    }
  }
  return failed ? 1 : 0;
}

if (import.meta.main) {
  const key = readResendKey();
  if (key === undefined) {
    console.error("BLOCKED: no RESEND_API_KEY");
    process.exitCode = 1;
  } else {
    process.exitCode = await checkDomains({ fetch, log: console.log }, key);
  }
}
