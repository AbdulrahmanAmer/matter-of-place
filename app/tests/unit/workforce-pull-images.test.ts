import { describe, expect, it } from "vitest";
import { imageUrls, unreadable } from "../../scripts/workforce/pull-images";

// W9 item 4: what a listing page offers as photographs, and when a person must open it instead.

const PAGE = "https://listings.example.com/homes/2400-azure-pl";

describe("the photographs a listing page names", () => {
  it("reads the share image, the structured data and the images, the widest of a srcset, absolute and once", () => {
    const html = `
      <meta property="og:image" content="https://cdn.example.com/a/hero.jpg?w=2048&amp;q=80">
      <script type="application/ld+json">{"@type":"Residence","image":"https://cdn.example.com/a/kitchen.webp"}</script>
      <img src="/photos/living-small.jpg" srcset="/photos/living-small.jpg 640w, /photos/living-large.jpg 2048w">
      <img data-src="https://cdn.example.com/a/garden.png">
      <img src="https://cdn.example.com/a/hero.jpg?w=2048&q=80">`;
    expect(imageUrls(html, PAGE)).toEqual([
      "https://cdn.example.com/a/hero.jpg?w=2048&q=80",
      "https://cdn.example.com/a/kitchen.webp",
      "https://listings.example.com/photos/living-large.jpg",
      "https://cdn.example.com/a/garden.png",
    ]);
  });

  it("leaves out logos and icons drawn as svg, gif or ico, and anything that is not http", () => {
    const html = `<img src="/logo.svg"><img src="/spinner.gif"><link rel=icon><img src="data:image/png;base64,AAAA">
      <img src="https://cdn.example.com/a/front.jpg">`;
    expect(imageUrls(html, PAGE)).toEqual(["https://cdn.example.com/a/front.jpg"]);
  });
});

describe("a page a person must open", () => {
  it("names a refusal, a login page and a password field, and lets a plain page through", () => {
    expect(unreadable(403, PAGE, "")).toBe("the page refused us (403); it may need a login");
    expect(unreadable(200, "https://listings.example.com/login?next=/homes", "")).toBe(
      "the link leads to a login page",
    );
    expect(unreadable(200, PAGE, '<form><input type="password" name="p"></form>')).toBe(
      "the page asks for a password",
    );
    expect(unreadable(404, PAGE, "")).toBe("the page answered 404");
    expect(unreadable(200, PAGE, "<img src=a.jpg>")).toBeNull();
  });
});
