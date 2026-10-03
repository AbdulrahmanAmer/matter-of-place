// B9 step 6: the render scripts that `scripts/render-job.mjs` imports each export `run`, and refuse a spec that is
// not theirs before a browser starts.
import { describe, expect, it } from "vitest";
import * as carousel from "../../../scripts/render-carousel.mjs";
import * as cover from "../../../scripts/render-cover.mjs";
import * as story from "../../../scripts/render-story.mjs";
import * as variants from "../../../scripts/render-variants.mjs";

function jobWith(keyPrefix: string) {
  const property = {
    id: "p1",
    slug: "oak-hill",
    title: "A residence",
    city: "Los Altos Hills",
    state: "California",
    market: "california",
    price: 8950000,
    currency: "USD",
    beds: 5,
    baths: 4.5,
    interiorSqFt: 4320,
    yearBuilt: 2021,
    type: "Estate",
  };
  const images = [{ url: "a.jpg", alt: "a", orientation: "landscape", w: 1600, h: 1200 }];
  return {
    payload: {
      data: { spec: { kind: "cover", property, images, out: { key_prefix: keyPrefix } } },
    },
  };
}

describe("render scripts", () => {
  it("each render script exports a function run", () => {
    for (const script of [cover, carousel, story, variants]) {
      expect(typeof script.run).toBe("function");
    }
  });

  it("refuses a key_prefix that is not assets/<property>/<kind>/r<revision>/", async () => {
    await expect(cover.run(jobWith("assets/p1/cover/"))).rejects.toThrow("key_prefix");
    await expect(story.run(jobWith("p1/story/r1/"))).rejects.toThrow("key_prefix");
  });
});
