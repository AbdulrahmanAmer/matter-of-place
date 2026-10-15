// W9 item 4 (operator, 2026-10-15: "make sure that our employees can pull the listing images on their own if the
// person submitting only sent the listing link"): the photographs of a request, pulled from its own photography,
// listing or source link into the studio folder, each with the address it came from, and with `--attach` added to the
// request's media the way an upload is (a row, the object at its path, `mark_media_uploaded`), so review and rendering
// can start. Only for a request whose rights are confirmed (`rights_confirmed_at`), never otherwise. A link that needs a
// login, or a page whose images cannot be read, is said plainly in the team thread instead.
// W8 0e (a run started by a person or Matter) is planned, not built: until it is, the runner or a person calls this.
//   bun scripts/workforce/pull-images.ts <request id>            pull into ~/.mop-workforce/studio/<request id>/
//   bun scripts/workforce/pull-images.ts <request id> --attach   and add them to the request's photographs
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Db } from "../../src/server/lib/db.ts";
import { sniffImageType } from "../../src/server/submissions/reconcile.ts";
import { serviceDb } from "./env.ts";

const STUDIO = join(homedir(), ".mop-workforce", "studio");
const BUCKET = "submissions";
const PAGE_MS = 20_000;
const IMAGE_MS = 30_000;
const MAX_IMAGES = 40;
// Below this a picture is an icon, a logo or a thumbnail, not a photograph of the house.
const MIN_BYTES = 30_000;
const MAX_BYTES = 25_000_000;
const AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MatterOfPlace-Studio/1.0 (+https://matterofplace.com)";

// ---------- what a page says (pure, tested in tests/unit/workforce-pull-images.test.ts) ----------

const decode = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

/** The widest candidate of a `srcset`. */
function widest(srcset: string): string | null {
  const candidates = srcset
    .split(",")
    .map((part) => part.trim().split(/\s+/))
    .map(([url = "", size = "1w"]) => ({ url, size: Number.parseFloat(size) || 1 }))
    .filter((candidate) => candidate.url !== "");
  return candidates.sort((a, b) => b.size - a.size)[0]?.url ?? null;
}

/** Every photograph address a page names: its share image, its structured data and its images, absolute and once. */
export function imageUrls(html: string, pageUrl: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(
    /<meta[^>]+(?:property|name)=["'](?:og:image(?::url)?|twitter:image)["'][^>]*>/gi,
  )) {
    const content = /content=["']([^"']+)["']/i.exec(match[0])?.[1];
    if (content !== undefined) found.push(content);
  }
  for (const match of html.matchAll(
    /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    for (const url of (match[1] ?? "").matchAll(
      /"(?:image|contentUrl|url)"\s*:\s*"(https?:[^"]+?\.(?:jpe?g|png|webp)[^"]*)"/gi,
    ))
      found.push(url[1] ?? "");
  }
  for (const match of html.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const tag = match[0];
    const srcset = /\s(?:data-)?srcset=["']([^"']+)["']/i.exec(tag)?.[1];
    const src = /\s(?:data-src|src)=["']([^"']+)["']/i.exec(tag)?.[1];
    const pick = srcset === undefined ? src : (widest(decode(srcset)) ?? src);
    if (pick !== undefined) found.push(pick);
  }
  const absolute = found.flatMap((raw) => {
    try {
      const url = new URL(decode(raw), pageUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") return [];
      if (/\.(svg|gif|ico)(\?|$)/i.test(url.pathname)) return [];
      return [url.href];
    } catch {
      return [];
    }
  });
  return [...new Set(absolute)];
}

/** Why a page cannot be read without a person: it asks for a login, or refuses us. Null when it can be read. */
export function unreadable(status: number, finalUrl: string, html: string): string | null {
  if (status === 401 || status === 403)
    return `the page refused us (${String(status)}); it may need a login`;
  if (status >= 400) return `the page answered ${String(status)}`;
  if (/\/(log-?in|sign-?in|auth|account\/login)\b/i.test(new URL(finalUrl).pathname))
    return "the link leads to a login page";
  if (/<input[^>]+type=["']password["']/i.test(html)) return "the page asks for a password";
  return null;
}

// ---------- the pull ----------

interface Pulled {
  file: string;
  source_url: string;
  page_url: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  sha256: string;
}

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

async function fetchPage(
  url: string,
): Promise<{ status: number; finalUrl: string; html: string } | string> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": AGENT, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(PAGE_MS),
    });
    return { status: response.status, finalUrl: response.url || url, html: await response.text() };
  } catch (error) {
    return `the page could not be reached (${error instanceof Error ? error.message : "no answer"})`;
  }
}

async function fetchImage(url: string, referer: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": AGENT, referer },
      signal: AbortSignal.timeout(IMAGE_MS),
    });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength < MIN_BYTES || bytes.byteLength > MAX_BYTES ? null : bytes;
  } catch {
    return null;
  }
}

/** Pulls every photograph its links show into the studio folder; returns what came and what could not be read. */
export async function pullImages(request: {
  id: string;
  links: readonly string[];
}): Promise<{ pulled: Pulled[]; problems: string[]; folder: string }> {
  const folder = join(STUDIO, request.id);
  mkdirSync(folder, { recursive: true });
  const pulled: Pulled[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const link of request.links) {
    const page = await fetchPage(link);
    if (typeof page === "string") {
      problems.push(`${link}: ${page}`);
      continue;
    }
    const refused = unreadable(page.status, page.finalUrl, page.html);
    if (refused !== null) {
      problems.push(`${link}: ${refused}`);
      continue;
    }
    const urls = imageUrls(page.html, page.finalUrl);
    let fromPage = 0;
    for (const url of urls) {
      if (pulled.length >= MAX_IMAGES) break;
      const bytes = await fetchImage(url, page.finalUrl);
      const type = bytes === null ? null : sniffImageType(bytes);
      if (
        bytes === null ||
        (type !== "image/jpeg" && type !== "image/png" && type !== "image/webp")
      )
        continue;
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (seen.has(sha256)) continue;
      seen.add(sha256);
      const file = `${String(pulled.length + 1).padStart(2, "0")}.${EXT[type]}`;
      writeFileSync(join(folder, file), bytes);
      pulled.push({
        file,
        source_url: url,
        page_url: link,
        mime: type,
        bytes: bytes.byteLength,
        sha256,
      });
      fromPage += 1;
    }
    if (fromPage === 0)
      problems.push(
        `${link}: no photograph on the page could be read (${String(urls.length)} addresses tried)`,
      );
  }
  writeFileSync(
    join(folder, "sources.json"),
    JSON.stringify(
      { request: request.id, pulled_at: new Date().toISOString(), images: pulled, problems },
      null,
      2,
    ),
  );
  return { pulled, problems, folder };
}

/** Adds the pulled photographs to the request's media, as an upload does. Answers how many were added. */
async function attach(
  client: Db,
  requestId: string,
  folder: string,
  pulled: readonly Pulled[],
): Promise<number> {
  const { readFileSync } = await import("node:fs");
  let added = 0;
  for (const image of pulled) {
    const { data, error } = await client.rpc("add_pulled_submission_media", {
      p_submission_id: requestId,
      p_name: image.file,
      p_mime: image.mime,
      p_bytes: image.bytes,
      p_source_url: image.source_url,
    });
    const row = data?.[0];
    if (error !== null || row === undefined) throw new Error(`pull: ${error?.message ?? "no row"}`);
    const upload = await client.storage
      .from(BUCKET)
      .upload(row.storage_path, readFileSync(join(folder, image.file)), {
        contentType: image.mime,
      });
    if (upload.error !== null)
      throw new Error(`pull: the photograph could not be stored (${upload.error.message})`);
    const marked = await client.rpc("mark_media_uploaded", {
      p_media_id: row.media_id,
      p_mime: image.mime,
      p_sha256: image.sha256,
    });
    if (marked.error !== null) throw new Error(`pull: ${marked.error.message}`);
    added += 1;
  }
  return added;
}

async function main(): Promise<void> {
  const [id, flag] = process.argv.slice(2);
  if (id === undefined || !/^[0-9a-f-]{36}$/.test(id)) {
    console.error("usage: bun scripts/workforce/pull-images.ts <request id> [--attach]");
    process.exitCode = 64;
    return;
  }
  const client = serviceDb();
  const { data: request, error } = await client
    .from("submissions")
    .select("id, rights_confirmed_at, photography_url, listing_url, source_url")
    .eq("id", id)
    .maybeSingle();
  if (error !== null || request === null) throw new Error("pull: the request could not be read");
  const say = (body: string) =>
    client.from("agent_messages").insert({
      thread: "team",
      author_kind: "system",
      author_id: "system",
      author_name: "Matter of Place",
      body,
    });
  // `rights_confirmed_at` is not null by schema (the form refuses a request without it), and
  // `add_pulled_submission_media` refuses again before anything is attached.
  console.log(`rights confirmed ${request.rights_confirmed_at}`);
  const links = [request.photography_url, request.listing_url, request.source_url].flatMap(
    (link) => (link === null || link.trim() === "" ? [] : [link.trim()]),
  );
  if (links.length === 0) {
    console.log("no link: nothing pulled");
    await say(`Request ${id} has no listing, photography or source link to pull photographs from.`);
    return;
  }
  const { pulled, problems, folder } = await pullImages({ id, links: [...new Set(links)] });
  console.log(`pulled ${String(pulled.length)} into ${folder}`);
  for (const problem of problems) console.log(`problem: ${problem}`);
  const added =
    flag === "--attach" && pulled.length > 0 ? await attach(client, id, folder, pulled) : 0;
  if (flag === "--attach") console.log(`attached ${String(added)}`);
  await say(
    [
      `Pulled ${String(pulled.length)} photographs for request ${id} into the studio folder${added > 0 ? ` and added ${String(added)} to the request` : ""}.`,
      ...problems.map((problem) => `Could not read ${problem}`),
    ].join("\n"),
  );
}

if (import.meta.main) await main();
