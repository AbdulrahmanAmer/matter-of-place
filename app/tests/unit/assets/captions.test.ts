// B9 step 9: the prompt and the lint loop of write_captions with a stub `complete` (invariant 5, ASSUMED H34).
import { describe, expect, it, vi } from "vitest";
import {
  loadCaptionModel,
  writeCaptions,
  type CaptionSpec,
  type Completion,
} from "../../../src/server/assets/captions";
import { propertyLink } from "../../../src/server/assets/links";
import type { CaptionProperty } from "../../../src/server/assets/voice";
import { NonRetryableError } from "../../../src/server/jobs/types";
import { fakeDb } from "../../fixtures/fake-db";

const MODEL = "claude-haiku-4-5-20251001";

const PROPERTY: CaptionProperty = {
  slug: "oak-hill",
  title: "A residence under old oaks",
  city: "Los Altos Hills",
  state: "California",
  type: "Estate",
  place: "A quiet street under old oaks.",
  price: 8_950_000,
  beds: 5,
  baths: 4.5,
  interior_sq_ft: 4320,
  year_built: 2021,
};

const SPEC: CaptionSpec = {
  images: [{ alt: "Alt zero" }, { alt: "Alt one" }, { alt: "Alt two" }],
  slides: [
    { kind: "cover", image: 0 },
    { kind: "photo", image: 1 },
    { kind: "photo", image: 2 },
    { kind: "facts", image: 0 },
    { kind: "close", image: 0 },
    { kind: "close", image: 1 },
  ],
};

const GOOD = {
  instagram: "A quiet house in the hills. Five bedrooms, built in 2021. $8,950,000.",
  x: `A quiet house in the hills. ${propertyLink("oak-hill", "x")}`,
  linkedin: "A house selected for its setting. The dossier is ready for an agent to share.",
  alt_text: "A stone house under an oak.",
  slide_alts: ["a", "b", "c", "d", "e", "f"],
};

const answer = (body: unknown, input = 10, output = 5): Completion => ({
  text: typeof body === "string" ? body : JSON.stringify(body),
  usage: { input_tokens: input, output_tokens: output },
});

function deps(...answers: Completion[]) {
  const complete = vi.fn<(prompt: string, signal: AbortSignal) => Promise<Completion>>();
  for (const next of answers) complete.mockResolvedValueOnce(next);
  const signal = new AbortController().signal;
  return { complete, signal, deps: { complete, model: MODEL, signal } };
}

describe("writeCaptions", () => {
  it("asks once, holds the voice rules and the facts in the prompt and passes the signal", async () => {
    const { complete, signal, deps: given } = deps(answer(GOOD));
    const written = await writeCaptions(PROPERTY, SPEC, given);
    expect(complete).toHaveBeenCalledTimes(1);
    const [prompt, passed] = complete.mock.calls[0] ?? [];
    expect(passed).toBe(signal);
    expect(prompt).toContain("em dash");
    expect(prompt).toContain("stunning");
    expect(prompt).toContain("$8,950,000");
    expect(prompt).toContain("4,320 square feet");
    expect(prompt).toContain(propertyLink("oak-hill", "x"));
    expect(written.caption_lint).toBe("passed");
    expect(written.captions.instagram).toBe(GOOD.instagram);
  });

  it("a lint failure asks again once with the failed check", async () => {
    const bad = { ...GOOD, instagram: "A stunning house." };
    const { complete, deps: given } = deps(answer(bad), answer(GOOD));
    const written = await writeCaptions(PROPERTY, SPEC, given);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0]).toContain('instagram: Do not use "stunning".');
    expect(written.caption_lint).toBe("passed");
    expect(written.captions.instagram).toBe(GOOD.instagram);
  });

  it("an answer that is not the caption JSON counts as a lint failure", async () => {
    const { complete, deps: given } = deps(answer("Here are your captions."), answer(GOOD));
    const written = await writeCaptions(PROPERTY, SPEC, given);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0]).toContain("not one JSON object");
    expect(written.caption_lint).toBe("passed");
  });

  it("an answer wrapped in a code fence is read", async () => {
    const { deps: given } = deps(answer(`\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\``));
    expect((await writeCaptions(PROPERTY, SPEC, given)).caption_lint).toBe("passed");
  });

  it("a caption that fails twice comes back flagged", async () => {
    const bad = { ...GOOD, instagram: "A stunning house." };
    const { complete, deps: given } = deps(answer(bad), answer(bad));
    const written = await writeCaptions(PROPERTY, SPEC, given);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(written.caption_lint).toBe("failed");
    expect(written.captions.instagram).toBe("A stunning house.");
  });

  it("a second answer that is not the caption JSON throws caption_answer_invalid", async () => {
    const bad = { ...GOOD, instagram: "A stunning house." };
    const { deps: given } = deps(answer(bad), answer("no json here"));
    await expect(writeCaptions(PROPERTY, SPEC, given)).rejects.toThrow(
      new NonRetryableError("caption_answer_invalid"),
    );
  });

  it("the usage is summed over the first answer and the retry", async () => {
    const bad = { ...GOOD, instagram: "A stunning house." };
    const { deps: given } = deps(answer(bad, 900, 300), answer(GOOD, 1100, 250));
    const written = await writeCaptions(PROPERTY, SPEC, given);
    expect(written.usage).toEqual({ model: MODEL, input_tokens: 2000, output_tokens: 550 });
  });

  it("one alt text comes back per slide, a missing one from its photograph", async () => {
    const { deps: given } = deps(answer({ ...GOOD, slide_alts: ["only one"] }));
    const written = await writeCaptions(PROPERTY, SPEC, given);
    expect(written.captions.slide_alts).toEqual([
      "only one",
      "Alt one",
      "Alt two",
      "Alt zero",
      "Alt zero",
      "Alt one",
    ]);
  });
});

describe("loadCaptionModel", () => {
  it("reads the model of settings.caption_model", async () => {
    const db = fakeDb({
      tables: {
        settings: [
          {
            key: "caption_model",
            value: MODEL,
            updated_at: "2026-10-03T09:00:00.000Z",
            updated_by: null,
          },
        ],
      },
    });
    expect(await loadCaptionModel(db)).toBe(MODEL);
  });

  it("a missing settings.caption_model throws caption_model_missing", async () => {
    const db = fakeDb({ tables: { settings: [] } });
    await expect(loadCaptionModel(db)).rejects.toThrow(
      new NonRetryableError("caption_model_missing"),
    );
  });
});
