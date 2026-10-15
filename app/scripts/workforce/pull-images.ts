// W9 item 4 (operator, 2026-10-15: "make sure that our employees can pull the listing images on their own if the
// person submitting only sent the listing link"): the photographs of a request, pulled from its own photography,
// listing or source link into the studio folder, each with the address it came from, and with `--attach` added to the
// request's media the way an upload is (a row, the object at its path, `mark_media_uploaded`), so review and rendering
// can start. Only for a request whose rights are confirmed (`rights_confirmed_at`), never otherwise. A link that needs a
// login, or a page whose images cannot be read, is said plainly in the team thread instead.
// W8 0e (a run started by a person or Matter) is planned, not built: until it is, the runner or a person calls this.
// W7 item 9 (operator, 2026-10-16: "keep one file per picture"): a listing names each photograph in several sizes (the
// Fairfield pull held 15 files of 5 pictures), so the pulled images are grouped by picture and the largest of each kept.
//   bun scripts/workforce/pull-images.ts <request id>            pull into ~/.mop-workforce/studio/<request id>/
//   bun scripts/workforce/pull-images.ts <request id> --attach   and add them to the request's photographs
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { Db } from "../../src/server/lib/db.ts";
import { sniffImageType } from "../../src/server/submissions/reconcile.ts";
import { serviceDb } from "./env.ts";

const STUDIO = join(homedir(), ".mop-workforce", "studio");
const BUCKET = "submissions";
const PAGE_MS = 20_000;
const IMAGE_MS = 30_000;
const MAX_IMAGES = 40;
// Pictures come in several sizes each, so more files are read than are kept.
const MAX_FETCHED = 120;
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

// ---------- one file per picture (W7 item 9) ----------

/** What tells one photograph from another size of it: its address, its pixels and a hash of its shapes. */
export interface Picture {
  url: string;
  width: number;
  height: number;
  bytes: number;
  /** A difference hash of a 9x8 grey thumbnail, 16 hex digits: the same picture at any size hashes nearly the same. */
  dhash: string;
}

// The marks image hosts add to one picture's name for each size: 1536x1152, -cc_ft_768, _960, w640,
// -uncropped_scaled_within_1536_1152. A picture's own id (a long hash, a photo number) is never one of them.
const SIZE_WORDS = new Set(["cc", "ft", "uncropped", "scaled", "within", "thumb", "resized"]);
const sizeMark = (token: string) =>
  /^\d{3,4}$/.test(token) ||
  /^\d+x\d+$/i.test(token) ||
  /^[wh]\d{2,4}$/i.test(token) ||
  SIZE_WORDS.has(token.toLowerCase());

/** The address of a picture without its size marks: the sizes of one picture share it (Zillow's do). */
export function sizeFamily(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    const parts = pathname.split("/").filter((part) => part !== "");
    const name = (parts.pop() ?? "").replace(/\.[a-z0-9]+$/i, "");
    const tokens = (text: string) => text.split(/[-_.,]/).filter((token) => token !== "");
    const dirs = parts.filter((part) => !tokens(part).every(sizeMark));
    const stem = tokens(name)
      .filter((token) => !sizeMark(token))
      .join("-");
    return `${host}/${[...dirs, stem].join("/")}`;
  } catch {
    return url;
  }
}

/** Bits that differ between two hashes. */
export function hashDistance(a: string, b: string): number {
  let bits = 0;
  for (let index = 0; index < 16; index += 1) {
    let xor = Number.parseInt(a[index] ?? "0", 16) ^ Number.parseInt(b[index] ?? "0", 16);
    for (; xor > 0; xor >>= 1) bits += xor & 1;
  }
  return bits;
}

// Two sizes of one picture differ by a few bits of 64, two photographs by about half. A shared size family is the
// second witness that lets a re-cropped size (Zillow's cc_ft) still count as the same picture.
const SAME_PICTURE_BITS = 8;
const SAME_FAMILY_BITS = 16;

/** Whether two images are one picture: their shapes match, more loosely when their addresses are one family. */
export function samePicture(a: Picture, b: Picture): boolean {
  const limit = sizeFamily(a.url) === sizeFamily(b.url) ? SAME_FAMILY_BITS : SAME_PICTURE_BITS;
  return hashDistance(a.dhash, b.dhash) <= limit;
}

/** Groups images by picture, in the order the pictures first appear, and keeps the largest of each. */
export function onePerPicture<T extends Picture>(images: readonly T[]): { kept: T; also: T[] }[] {
  const groups: T[][] = [];
  for (const image of images) {
    const group = groups.find((members) => members.some((member) => samePicture(member, image)));
    if (group === undefined) groups.push([image]);
    else group.push(image);
  }
  const area = (image: T) => image.width * image.height;
  return groups.flatMap((members) => {
    const [kept, ...also] = [...members].sort((a, b) => area(b) - area(a) || b.bytes - a.bytes);
    return kept === undefined ? [] : [{ kept, also }];
  });
}

/** An image's size and shape hash, or null when it cannot be decoded. */
export async function describePicture(
  bytes: Uint8Array,
  url: string,
): Promise<Picture | null> {
  try {
    const { width, height } = await sharp(bytes).metadata();
    const grey = await sharp(bytes).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    let dhash = "";
    for (let row = 0; row < 8; row += 1) {
      let byte = 0;
      for (let column = 0; column < 8; column += 1) {
        const left = grey[row * 9 + column] ?? 0;
        const right = grey[row * 9 + column + 1] ?? 0;
        byte = (byte << 1) | (left < right ? 1 : 0);
      }
      dhash += byte.toString(16).padStart(2, "0");
    }
    return { url, width, height, bytes: bytes.byteLength, dhash };
  } catch {
    return null;
  }
}

// ---------- the pull ----------

interface Pulled {
  file: string;
  source_url: string;
  page_url: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  /** The other sizes of this picture that were read and not kept. */
  same_picture: string[];
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

/** An image read from a page, before the pictures are grouped. */
type Fetched = Picture & {
  data: Uint8Array;
  mime: Pulled["mime"];
  sha256: string;
  page_url: string;
};

/** Writes the largest size of each picture into the folder, numbered in page order; the rest are only named. */
export function keepPictures(read: readonly Fetched[], folder: string): Pulled[] {
  return onePerPicture(read)
    .slice(0, MAX_IMAGES)
    .map(({ kept, also }, index) => {
      const file = `${String(index + 1).padStart(2, "0")}.${EXT[kept.mime]}`;
      writeFileSync(join(folder, file), kept.data);
      return {
        file,
        source_url: kept.url,
        page_url: kept.page_url,
        mime: kept.mime,
        bytes: kept.bytes,
        sha256: kept.sha256,
        width: kept.width,
        height: kept.height,
        same_picture: also.map((image) => image.url),
      };
    });
}

/** Pulls every photograph its links show into the studio folder; returns what came and what could not be read. */
export async function pullImages(request: {
  id: string;
  links: readonly string[];
}): Promise<{ pulled: Pulled[]; problems: string[]; folder: string }> {
  const folder = join(STUDIO, request.id);
  mkdirSync(folder, { recursive: true });
  const read: Fetched[] = [];
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
      if (read.length >= MAX_FETCHED) break;
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
      const picture = await describePicture(bytes, url);
      if (picture === null) continue;
      read.push({ ...picture, data: bytes, mime: type, sha256, page_url: link });
      fromPage += 1;
    }
    if (fromPage === 0)
      problems.push(
        `${link}: no photograph on the page could be read (${String(urls.length)} addresses tried)`,
      );
  }
  const pulled = keepPictures(read, folder);
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
  await say(pulledLine(id, pulled.length, added, problems.length));
}

/**
 * The team-thread line after a pull (W8 review, third): counts only. The links are text the submitter typed and the
 * reasons can quote the page, so neither enters a thread every colleague's prompt reads; they are in the studio
 * folder's sources.json and on the request page, for a person.
 */
export function pulledLine(id: string, pulled: number, added: number, unread: number): string {
  return [
    `Pulled ${String(pulled)} photographs for request ${id} into the studio folder${added > 0 ? ` and added ${String(added)} to the request` : ""}.`,
    ...(unread > 0
      ? [
          `${String(unread)} of its links could not be read; the reasons are in the studio folder's sources.json and the links on the request page.`,
        ]
      : []),
  ].join("\n");
}

if (import.meta.main) await main();
