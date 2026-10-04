// Copy voice (R46, brand guardrails): calm, brief, specific. The mechanical parts of it, enforced on the strings of
// the coming-soon block and the consent notice, with each placeholder filled by a real market name.
import { describe, expect, it } from "vitest";
import { fill, t } from "../../src/lib/strings";

function leaves(value: unknown, path: string): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => leaves(child, `${path}.${key}`));
}

const copy = [...leaves(t.comingSoon, "comingSoon"), ...leaves(t.consent, "consent")];
const markets = ["California", "New York", "Florida"];

const BANNED =
  /exclusive|guarantee|stunning|luxury|unlock|buyers?\b|leads?\b|dream|world-class|once in a lifetime/i;
const OTHER_PLACES = /\b(global|worldwide|international|europe|london|paris|dubai|texas|nevada)\b/i;

describe("the coming-soon and consent copy", () => {
  it("holds 31 strings", () => {
    expect(copy).toHaveLength(31);
  });

  it("has no em dash, en dash or exclamation mark", () => {
    expect(copy.filter(([, text]) => /[–—!]/.test(text)).map(([path]) => path)).toEqual([]);
  });

  it("has no hyperbole and promises no leads, buyers or sales", () => {
    expect(copy.filter(([, text]) => BANNED.test(text)).map(([path]) => path)).toEqual([]);
  });

  it("is brief: no string is longer than 200 characters", () => {
    expect(copy.filter(([, text]) => text.length > 200).map(([path]) => path)).toEqual([]);
  });

  it("names no market outside California, New York and Florida", () => {
    expect(copy.filter(([, text]) => OTHER_PLACES.test(text)).map(([path]) => path)).toEqual([]);
  });

  it("uses only the placeholders fill() gives, and a filled string keeps none", () => {
    const names = new Set(
      copy.flatMap(([, text]) => [...text.matchAll(/\{(\w+)\}/g)]).map((m) => m[1]),
    );
    expect([...names].sort()).toEqual(["intro", "market", "region"]);
    for (const market of markets) {
      for (const [path, text] of copy) {
        const filled = fill(text, { market, region: "Miami", intro: "A quiet market." });
        expect([path, /\{\w+\}/.test(filled)]).toEqual([path, false]);
      }
    }
  });
});
