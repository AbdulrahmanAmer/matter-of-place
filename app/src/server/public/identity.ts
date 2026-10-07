import { siteSettingsSchema } from "../../domain/settings";
import { getDb } from "../lib/db";
import { AppError, toErrorResponse } from "../lib/errors";
import { browserCacheControl } from "../lib/pipeline";
import { getPublicState } from "./state";

// The `.well-known` documents (B17 step 3). None is stored by the cache module: each answers with its own header.

const ORIGIN = "https://matterofplace.com";
const SECURITY_CONTACT = "security@matterofplace.com";
const SECURITY_VALID_DAYS = 180;
const MTA_STS_HOST = "mta-sts.matterofplace.com";
const MTA_STS_MX = ["mx.zoho.com", "mx2.zoho.com", "mx3.zoho.com"];
const DAY_MS = 24 * 60 * 60 * 1000;

const notFound = new AppError("not_found", undefined, "There is nothing at this address.");

function refuseWrite(request: Request, requestId: string): Response | undefined {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const response = toErrorResponse(
    new AppError("method_not_allowed", undefined, "This address does not accept that method."),
    requestId,
  );
  response.headers.set("allow", "GET, HEAD");
  return response;
}

function plainText(request: Request, lines: readonly string[]): Response {
  return new Response(request.method === "HEAD" ? null : `${lines.join("\n")}\n`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": browserCacheControl("doc"),
    },
  });
}

/** RFC 9116. `Expires` is 180 days after the request, so the file never lapses and stays under the RFC's year. */
export async function securityTxt(request: Request, requestId: string): Promise<Response> {
  const refused = refuseWrite(request, requestId);
  if (refused !== undefined) return refused;
  const site = siteSettingsSchema.safeParse((await getPublicState(getDb())).site);
  const contact = site.success ? site.data.contact.email : null;
  return plainText(request, [
    `Contact: mailto:${contact ?? SECURITY_CONTACT}`,
    `Expires: ${new Date(Date.now() + SECURITY_VALID_DAYS * DAY_MS).toISOString()}`,
    "Preferred-Languages: en",
    `Canonical: ${ORIGIN}/.well-known/security.txt`,
    `Policy: ${ORIGIN}/legal`,
  ]);
}

/** The admin's sign-in page; password managers follow this address to the place a password is changed. */
export function changePassword(request: Request, requestId: string): Response {
  return (
    refuseWrite(request, requestId) ??
    new Response(null, {
      status: 302,
      headers: { location: "/admin/sign-in", "cache-control": "no-store" },
    })
  );
}

/** RFC 8461 policy, served only on the `mta-sts` host that `scripts/cf-edge.mjs` attaches. */
export function mtaStsTxt(request: Request, requestId: string): Response {
  const refused = refuseWrite(request, requestId);
  if (refused !== undefined) return refused;
  const host = (request.headers.get("host") ?? new URL(request.url).host).split(":")[0];
  if (host?.toLowerCase() !== MTA_STS_HOST) return toErrorResponse(notFound, requestId);
  return plainText(request, [
    "version: STSv1",
    "mode: testing",
    ...MTA_STS_MX.map((mx) => `mx: ${mx}`),
    "max_age: 86400",
  ]);
}
