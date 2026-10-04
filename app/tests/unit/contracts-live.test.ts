// The contracts the live API shares with the forms (G-004): every list the SQL checks hold is the same list in Zod, and
// the limits are one number for the API, the forms and the database. Unit test: it reads the migrations as text.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { maxFiles } from "../../src/components/forms/submit/state";
import {
  clientErrorSchema,
  propertyCardSchema,
  subjectRequestKinds,
  submissionSchema,
  submissionUploadsSchema,
  subscriberSchema,
  uploadLimits,
} from "../../src/domain/contracts";
import { marketSlugSchema } from "../../src/domain/market";
import { properties } from "../../src/data/properties";

const MIGRATIONS = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

/** The text of the one migration whose file name ends in `_<name>.sql` (the timestamp is whatever it was pushed as). */
function migration(name: string): string {
  const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith(`_${name}.sql`));
  const file = files[0];
  if (files.length !== 1 || file === undefined) {
    throw new Error(`expected one migration named ${name}, found ${String(files.length)}`);
  }
  return readFileSync(`${MIGRATIONS}${file}`, "utf8");
}

/** The quoted values of `<anchor> ... ('a', 'b')` or `array['a', 'b']`: the list that follows the anchor. */
function quotedList(text: string, anchor: RegExp): string[] {
  const start = anchor.exec(text);
  if (start === null) throw new Error(`no ${String(anchor)} in the migration`);
  const rest = text.slice(start.index + start[0].length);
  const list = /^[^;)\]]*/.exec(rest)?.[0] ?? "";
  return [...list.matchAll(/'([^']+)'/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

describe("subscriberSchema.markets", () => {
  it("is the list of the database check subscribers_markets_subset", () => {
    const check = quotedList(
      migration("intake"),
      /subscribers_markets_subset check \(markets <@ array\[/,
    );
    expect([...marketSlugSchema.options].sort()).toEqual([...check].sort());
  });

  it("defaults to no market and takes at most three, each one of the three", () => {
    const email = { email: "reader@example.test", source: "stories" };
    expect(subscriberSchema.parse(email).markets).toEqual([]);
    expect(
      subscriberSchema.parse({ ...email, markets: ["california", "florida"] }).markets,
    ).toEqual(["california", "florida"]);
    expect(subscriberSchema.safeParse({ ...email, markets: ["texas"] }).success).toBe(false);
    expect(
      subscriberSchema.safeParse({
        ...email,
        markets: ["california", "florida", "new-york", "california"],
      }).success,
    ).toBe(false);
  });
});

describe("subjectRequestKinds", () => {
  it("is the list of the database check on subject_requests.kind", () => {
    const check = quotedList(
      migration("public_write_functions"),
      /kind text not null check \(kind in \(/,
    );
    expect([...subjectRequestKinds]).toEqual(check);
  });
});

describe("the upload limits", () => {
  it("are one number for the form and the contract", () => {
    expect(maxFiles).toBe(uploadLimits.maxFiles);
  });

  const photo = { name: "a.jpg", size: 1000, type: "image/jpeg" };
  const base = {
    address: "1 Test Way",
    city: "Berkeley",
    state: "California",
    zip: "94702",
    currency: "USD",
    propertyType: "Residence",
    submitterKind: "owner",
    submitterName: "Test Owner",
    submitterEmail: "owner@example.test",
    story: "A story.",
    significance: "A reason.",
    package: "The Feature",
    rightsConfirmed: true,
    sourcePath: "/submit",
  };
  const accepts = (media: object[]) => submissionSchema.safeParse({ ...base, media }).success;

  it("let a submission name 40 photographs and no more", () => {
    expect(accepts(Array.from({ length: uploadLimits.maxFiles }, () => photo))).toBe(true);
    expect(accepts(Array.from({ length: uploadLimits.maxFiles + 1 }, () => photo))).toBe(false);
  });

  it("refuse a photograph over the size limit or of another type", () => {
    expect(accepts([{ ...photo, size: uploadLimits.maxBytes }])).toBe(true);
    expect(accepts([{ ...photo, size: uploadLimits.maxBytes + 1 }])).toBe(false);
    for (const type of uploadLimits.types) expect(accepts([{ ...photo, type }])).toBe(true);
    expect(accepts([{ ...photo, type: "application/pdf" }])).toBe(false);
  });
});

describe("propertyCardSchema", () => {
  const first = properties[0];

  it("keeps the card fields and the card rendition and drops everything else", () => {
    if (first === undefined) throw new Error("no bundled property");
    const rendition = { w: 720, h: 540, webp: "/media/v/o/1-aaaaaaaa/card.webp" };
    const card = propertyCardSchema.parse({
      ...first,
      heroVariants: { card: rendition, hero: { ...rendition, w: 1600 } },
    });
    expect(Object.keys(card)).not.toContain("gallery");
    expect(Object.keys(card)).not.toContain("story");
    expect(Object.keys(card)).not.toContain("video");
    expect(card.heroVariants).toEqual({ card: rendition });
    expect(card).toMatchObject({
      slug: first.slug,
      price: first.price,
      heroImage: first.heroImage,
      features: first.features,
      publishedAt: first.publishedAt,
    });
  });

  it("refuses a record with no slug", () => {
    if (first === undefined) throw new Error("no bundled property");
    const { slug: _slug, ...withoutSlug } = first;
    expect(propertyCardSchema.safeParse(first).success).toBe(true);
    expect(propertyCardSchema.safeParse(withoutSlug).success).toBe(false);
  });
});

describe("submissionUploadsSchema", () => {
  const id = "0d5e1c1e-2b4a-4b8e-9c1f-3a7d6e5f4b3a";

  it("takes one to ten media ids and a token", () => {
    const token = { upload_token: "t.s" };
    expect(submissionUploadsSchema.safeParse({ media_ids: [id], ...token }).success).toBe(true);
    expect(
      submissionUploadsSchema.safeParse({ media_ids: Array(10).fill(id), ...token }).success,
    ).toBe(true);
    expect(submissionUploadsSchema.safeParse({ media_ids: [], ...token }).success).toBe(false);
    expect(
      submissionUploadsSchema.safeParse({ media_ids: Array(11).fill(id), ...token }).success,
    ).toBe(false);
    expect(submissionUploadsSchema.safeParse({ media_ids: ["nope"], ...token }).success).toBe(
      false,
    );
    expect(
      submissionUploadsSchema.safeParse({ media_ids: [id], upload_token: "x".repeat(201) }).success,
    ).toBe(false);
  });
});

describe("clientErrorSchema", () => {
  it("takes a message and a route, and bounds every text", () => {
    const base = { message: "boom", route: "/properties" };
    expect(clientErrorSchema.safeParse(base).success).toBe(true);
    expect(clientErrorSchema.safeParse({ ...base, message: "x".repeat(501) }).success).toBe(false);
    expect(clientErrorSchema.safeParse({ ...base, stack: "x".repeat(2049) }).success).toBe(false);
    expect(clientErrorSchema.safeParse({ ...base, route: "x".repeat(201) }).success).toBe(false);
    expect(clientErrorSchema.safeParse({ ...base, release: "x".repeat(101) }).success).toBe(false);
    expect(clientErrorSchema.safeParse({ ...base, requestId: "x".repeat(101) }).success).toBe(
      false,
    );
    expect(clientErrorSchema.safeParse({ route: "/" }).success).toBe(false);
  });
});
