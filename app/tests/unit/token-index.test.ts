import { describe, expect, it } from "vitest";
import {
  buildTokenIndex,
  lookup,
  tokenize,
  type Indexed,
} from "../../src/server/search/token-index";

const property = (slug: string, over: Partial<Indexed>): Indexed => ({
  place: "",
  city: "",
  neighborhood: "",
  address: "",
  title: "",
  slug,
  ...over,
});

const find = (properties: Indexed[], text: string) =>
  lookup(buildTokenIndex(properties), text).map((hit) => hit.slug);

describe("tokenize", () => {
  it("lower-cases, drops accents and punctuation, and leaves out words that carry no meaning", () => {
    expect(tokenize("The Café at Rue d'Aubigné, with a pool!")).toEqual([
      "cafe",
      "rue",
      "d",
      "aubigne",
      "pool",
    ]);
  });

  it("folds plurals so a word and its plural are one token, and leaves words that end in ss, us or is", () => {
    expect(tokenize("houses house")).toEqual(["house"]);
    expect(tokenize("boxes churches properties glasses")).toEqual([
      "box",
      "church",
      "property",
      "glass",
    ]);
    expect(tokenize("glass Paris campus")).toEqual(["glass", "paris", "campus"]);
  });
});

describe("lookup", () => {
  const houses = [
    property("a", { title: "The Quiet House", architect: "Anselm Kerrigan" }),
    property("b", { title: "Harbour Lofts", designer: "Mirela Voss", address: "12 Alder Lane" }),
    property("c", { title: "Orchard Estate", place: "Above the Mendocino coast" }),
  ];

  it("finds a property by a word only one of its text fields holds", () => {
    expect(find(houses, "Kerrigan")).toEqual(["a"]);
    expect(find(houses, "Voss")).toEqual(["b"]);
    expect(find(houses, "Alder Lane")).toEqual(["b"]);
    expect(find(houses, "Mendocino")).toEqual(["c"]);
  });

  it("finds the singular by the plural and the plural by the singular (F25 g)", () => {
    expect(find(houses, "houses")).toEqual(["a"]);
    expect(find([property("p", { title: "Two Houses by the Sea" })], "house")).toEqual(["p"]);
  });

  it("matches a prefix of three characters or more, never a shorter one", () => {
    expect(find(houses, "kerr")).toEqual(["a"]);
    expect(find(houses, "ke")).toEqual([]);
  });

  it("counts the distinct query words that hit and names the fields that held them", () => {
    const [hit] = lookup(buildTokenIndex(houses), "quiet house kerrigan nowhere");
    expect(hit).toEqual({ slug: "a", hits: 3, fields: ["Title", "Architect"] });
  });

  it("returns nothing for a query of stop words or of words no property holds", () => {
    expect(find(houses, "the with a")).toEqual([]);
    expect(find(houses, "zzzz")).toEqual([]);
  });
});
