import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderTheme } from "../../scripts/gen-theme";
import { themeHex, themeRgb } from "../../src/templates/theme.gen";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const tokens = read("../../src/styles/tokens.css");
const tokenOf = (token: string): string | undefined =>
  new RegExp(`^\\s*${token}:\\s*(#[0-9a-fA-F]{6})\\s*;`, "m").exec(tokens)?.[1]?.toLowerCase();

const names = {
  background: "--background",
  foreground: "--foreground",
  secondary: "--secondary",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
} as const;

describe("theme.gen.ts", () => {
  it("is exactly what gen-theme writes from tokens.css", () => {
    expect(read("../../src/templates/theme.gen.ts")).toBe(renderTheme(tokens));
  });

  it.each(Object.entries(names))("%s equals the %s token", (name, token) => {
    const hex: Record<string, string> = themeHex;
    expect(hex[name]).toBe(tokenOf(token));
  });

  it("holds each colour as a 0 to 1 triple of the same bytes", () => {
    const hexOfTriple = (triple: readonly number[]): string =>
      `#${triple
        .map((v) =>
          Math.round(v * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`;
    const fromRgb = Object.fromEntries(
      Object.entries(themeRgb).map(([name, triple]) => [name, hexOfTriple(triple)]),
    );
    expect(fromRgb).toEqual(themeHex);
  });

  it("refuses a tokens file that lacks a colour", () => {
    expect(() => renderTheme(tokens.replace("--accent:", "--accent-x:"))).toThrow(/--accent/);
  });
});
