// B12 step 3, invariant 3: the scene moves only with the vocabulary of MOTION-BIBLE section 2 and its approved eases.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
const scene = read("launch/reel/scene.mjs");
const page = read("launch/reel/scene.html");
const film = read("launch/engine/runtime/film.js");

// The launch film's approved set (what the helpers of film.js may use) plus `none` for camera moves on photographs.
const HELPER_EASES = [
  "expo.out",
  "power3.in",
  "power3.out",
  "power1.out",
  "power1.inOut",
  "power3.inOut",
  "power2.out",
];
const SCENE_EASES = [...HELPER_EASES, "none"];
const SPRING_LIMIT = 1.3;

/** The span of `function <name>(...) { ... }` in the source, found by matching braces. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `function ${name} exists`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let at = open; at < source.length; at++) {
    if (source[at] === "{") depth++;
    if (source[at] === "}" && --depth === 0) return source.slice(start, at + 1);
  }
  throw new Error(`function ${name} does not close`);
}

describe("the reel scene", () => {
  it("eases only with the approved set", () => {
    const literals = [...scene.matchAll(/\bease:\s*(["'`])(.*?)\1/g)];
    const used = literals.map((m) => m[2] ?? "").filter((ease) => !ease.startsWith("back.out("));
    expect(used.length).toBeGreaterThan(5);
    expect(used.filter((ease) => !SCENE_EASES.includes(ease))).toEqual([]);
  });

  it("writes every ease as a literal, so the check above sees it", () => {
    expect([...scene.matchAll(/\bease\s*:/g)]).toHaveLength(
      [...scene.matchAll(/\bease:\s*["'`]/g)].length,
    );
    expect(page).not.toMatch(/\bease\s*:|transition|animation/);
  });

  it("springs only on the grid, inside gridAssemble, at 1.3 or less", () => {
    const grid = bodyOf(scene, "gridAssemble");
    const springs = [...scene.matchAll(/back\.out\(([\d.]+)\)/g)];
    expect(springs.length).toBeGreaterThan(0);
    expect(grid.match(/back\.out\(/g)).toHaveLength(springs.length);
    for (const spring of springs) {
      expect(Number(spring[1])).toBeLessThanOrEqual(SPRING_LIMIT);
    }
    expect(page).not.toMatch(/back\.out/);
  });

  it("names none of the banned motions or looks in the scene or its page", () => {
    const banned = /\b(?:bounce|elastic|rough|particle|gradient|glow)/i;
    expect(scene.match(banned)).toBeNull();
    expect(page.match(banned)).toBeNull();
  });

  it("draws M11 in lightSweep as a blurred solid Bone layer moved once at none", () => {
    const sweep = bodyOf(scene, "lightSweep");
    expect(sweep).toContain("blur(60px)");
    expect(sweep).toContain('"var(--secondary)"');
    expect(sweep.match(/ease: "none"/g)).toHaveLength(1);
  });

  it("draws the legibility layer in scrim as a solid Obsidian layer of fixed opacity", () => {
    const body = bodyOf(scene, "scrim");
    expect(body).toContain("layer.style.opacity");
    expect(body).not.toMatch(/\btl\./);
    expect(page).toMatch(/\.scrim > div \{[^}]*background: var\(--foreground\)/);
  });
});

describe("the film helpers the scene calls", () => {
  it("ease only with the approved set, defaults included", () => {
    const eases = [...film.matchAll(/\bease\s*[:=]\s*"([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(eases.length).toBeGreaterThan(8);
    expect(eases.filter((ease) => !HELPER_EASES.includes(ease))).toEqual([]);
  });
});
