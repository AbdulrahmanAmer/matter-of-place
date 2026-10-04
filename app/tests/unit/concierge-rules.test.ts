import { describe, expect, it } from "vitest";
import { conciergeQuestions } from "../../src/domain/contracts";
import { properties } from "../../src/data/properties";
import { answerFor } from "../../src/lib/concierge-rules";
import { pickCard } from "../../src/lib/property-card";
import { localConcierge } from "../../src/services/local/concierge";

const cards = properties.map(pickCard);
const [first] = properties;
if (first === undefined) throw new Error("no bundled property");

describe("answerFor", () => {
  it("answers availability from the status and leaves the confirmation to the representative", () => {
    const answer = answerFor(first, "Is the property still available?", cards);
    expect(answer.text).toContain(first.status.toLowerCase());
    expect(answer.text).toContain("confirmed by the listing representative");
  });

  it("answers a showing request with the showing action", () => {
    expect(answerFor(first, "Can I request a private showing?", cards).action).toBe("showing");
  });

  it("names a nearby property that is not the one asked about", () => {
    const answer = answerFor(first, "Are there similar properties nearby?", cards);
    expect(answer.link?.slug).toBeDefined();
    expect(answer.link?.slug).not.toBe(first.slug);
    expect(answer.text).toContain("Nearby, you may also like");
  });

  it("says so when the pool holds nothing else", () => {
    const alone = cards.filter((card) => card.slug === first.slug);
    expect(answerFor(first, "Are there similar properties nearby?", alone)).toEqual({
      text: "There are no other properties in this area yet.",
    });
  });

  it("summarises the facts of the dossier", () => {
    const { text } = answerFor(first, "Can you send the full details?", cards);
    expect(text).toContain(`${String(first.beds)} bedrooms`);
    expect(text).toContain(`built ${String(first.yearBuilt)}`);
  });

  it.each(conciergeQuestions)(
    "answers the same through the local adapter: %s",
    async (question) => {
      expect(await localConcierge.answer({ propertySlug: first.slug, question })).toEqual(
        answerFor(first, question, properties),
      );
    },
  );

  it("rejects an unknown property in the local adapter", async () => {
    await expect(
      localConcierge.answer({ propertySlug: "no-such-property", question: conciergeQuestions[0] }),
    ).rejects.toMatchObject({ kind: "not-found" });
  });
});
