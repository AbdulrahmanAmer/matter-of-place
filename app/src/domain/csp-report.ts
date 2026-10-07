import { z } from "zod";

// Server only: the browser bundle never imports this file, so its schemas stay out of the first load (R60).
const cut = (max: number) => (text: string) => text.trim().slice(0, max);
/** A blocked address without its query or fragment: a report never stores what a visitor's URL carried. */
const withoutQuery = (text: string): string => {
  const trimmed = text.trim();
  if (!URL.canParse(trimmed)) return cut(200)(trimmed);
  const { protocol, origin, pathname } = new URL(trimmed);
  return cut(200)(protocol === "http:" || protocol === "https:" ? `${origin}${pathname}` : trimmed);
};
const pathOnly = (text: string): string =>
  cut(200)(URL.canParse(text.trim()) ? new URL(text.trim()).pathname : text);

/** One violation as the database stores it: short strings only, so a row's `data` stays under 1 KB. */
export interface CspReport {
  path: string;
  directive: string;
  blockedUri: string;
  disposition: string;
}

const toReport = (
  documentUrl: string,
  directive: string,
  blocked: string,
  disposition: string,
): CspReport => ({
  path: pathOnly(documentUrl),
  directive: cut(100)(directive),
  blockedUri: withoutQuery(blocked),
  disposition: cut(20)(disposition),
});

const reportingApiViolation = z
  .object({
    type: z.literal("csp-violation"),
    body: z.object({
      documentURL: z.string(),
      effectiveDirective: z.string(),
      blockedURL: z.string().default(""),
      disposition: z.string().default("report"),
    }),
  })
  .transform(({ body }) =>
    toReport(body.documentURL, body.effectiveDirective, body.blockedURL, body.disposition),
  );

const legacyViolation = z
  .object({
    "csp-report": z.object({
      "document-uri": z.string(),
      "effective-directive": z.string(),
      "blocked-uri": z.string().default(""),
      disposition: z.string().default("report"),
    }),
  })
  .transform(({ "csp-report": report }) => [
    toReport(
      report["document-uri"],
      report["effective-directive"],
      report["blocked-uri"],
      report.disposition,
    ),
  ]);

/**
 * The body of `POST /csp-report`: a Reporting API array (`application/reports+json`) or the legacy single report
 * (`application/csp-report`), both normalised to 1 to 20 `{ path, directive, blockedUri, disposition }`.
 */
export const cspReportBatchSchema = z.union([
  z.array(reportingApiViolation).min(1).max(20),
  legacyViolation,
]);
