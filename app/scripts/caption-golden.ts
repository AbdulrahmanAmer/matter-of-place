// B9 step 9, ASSUMED H34 (7): the live golden check, run on the laptop. `bun run scripts/caption-golden.ts` asks the
// Claude CLI for the three caption variants of the fixture property, prints each with its lint result and the token
// usage, and writes nothing. Exit 1 on a lint failure, 2 when the CLI does not answer `--version`.
import { z } from "zod";
import { writeCaptions, loadCaptionModel } from "../src/server/assets/captions.ts";
import { lintCaption, type CaptionChannel } from "../src/server/assets/voice.ts";
import { planCarousel } from "../src/templates/social/slides.ts";
import fixture from "../src/templates/social/fixtures/property.fixture.json";
import { captionsDb, cliMissing, runClaudeCli } from "./captions-runner.ts";

const MAX_SLIDES = 8;
const BUDGET_MS = 270_000;

const subject = z.object({
  property: z.object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    city: z.string(),
    state: z.string(),
    market: z.string(),
    type: z.string(),
    place: z.string(),
    price: z.number(),
    currency: z.string(),
    beds: z.number(),
    baths: z.number(),
    interiorSqFt: z.number(),
    yearBuilt: z.number(),
  }),
  images: z.array(
    z.object({
      path: z.string(),
      alt: z.string(),
      orientation: z.enum(["landscape", "portrait"]),
      w: z.number(),
      h: z.number(),
    }),
  ),
});

async function main(): Promise<number> {
  const missing = await cliMissing();
  if (missing !== null) {
    console.log(`BLOCKED: caption CLI not found: ${missing}`);
    return 2;
  }
  const { property: facts, images } = subject.parse(fixture);
  const property = {
    slug: facts.slug,
    title: facts.title,
    city: facts.city,
    state: facts.state,
    type: facts.type,
    place: facts.place,
    price: facts.price,
    beds: facts.beds,
    baths: facts.baths,
    interior_sq_ft: facts.interiorSqFt,
    year_built: facts.yearBuilt,
  };
  const spec = {
    images,
    slides: planCarousel(
      { property: facts, images: images.map(({ path, ...image }) => ({ url: path, ...image })) },
      MAX_SLIDES,
    ),
  };

  const model = await loadCaptionModel(captionsDb());
  const written = await writeCaptions(property, spec, {
    complete: (prompt, signal) => runClaudeCli(prompt, model, signal),
    model,
    signal: AbortSignal.timeout(BUDGET_MS),
  });

  let failures = 0;
  const channels: CaptionChannel[] = ["instagram", "x", "linkedin"];
  for (const channel of channels) {
    const text = written.captions[channel];
    const issues = lintCaption(text, property, channel);
    failures += issues.length;
    console.log(`${channel} (${String(text.length)} characters)\n${text}`);
    console.log(
      issues.length === 0 ? "lint: pass" : `lint: fail, ${issues.map((i) => i.message).join(" ")}`,
    );
  }
  console.log(`alt_text: ${written.captions.alt_text}`);
  console.log(`slide_alts: ${String(written.captions.slide_alts.length)}`);
  console.log(`usage: ${JSON.stringify(written.usage)}`);
  return failures === 0 && written.caption_lint === "passed" ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
