import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Admin pass (2026-10-12): W3 deleted the `.admin-recipes` styles while the Emails screen still drew with them, and the
// screen fell apart with nothing red. Every admin class a screen names must have a rule in the admin styles.

const app = join(import.meta.dirname, "..", "..");

function files(dir: string, ending: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, ending);
    return ending.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

/** The `admin-*` and `wf-*` classes written literally in a className string or template. */
function classesIn(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
    const value = match[1] ?? match[2] ?? "";
    for (const token of value.split(/\s+/)) {
      if (/^(admin|wf)-[a-z0-9_-]+$/.test(token)) found.add(token);
    }
  }
  return [...found];
}

describe("the admin's classes", () => {
  it("has a style rule for every admin class a screen names", () => {
    const css = files(join(app, "src", "styles", "admin"), /\.css$/)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const screens = [
      ...files(join(app, "src", "admin"), /\.tsx$/),
      ...files(join(app, "src", "routes", "admin"), /\.tsx$/),
    ];
    const missing = screens.flatMap((path) =>
      classesIn(readFileSync(path, "utf8"))
        .filter((name) => !new RegExp(`\\.${name}(?![a-z0-9_-])`).test(css))
        .map((name) => `${path.slice(app.length + 1)}: ${name}`),
    );
    expect(missing).toEqual([]);
  });

  // A phone rule once hid `.admin-actor` everywhere, so every "who did it" badge in every table went blank.
  it("keeps every name badge visible on a phone: only a rule inside the bar may hide one", () => {
    const css = files(join(app, "src", "styles", "admin"), /\.css$/)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const hiding = [...css.matchAll(/([^{}]*\.admin-actor[^{}]*)\{([^}]*)\}/g)]
      .filter((rule) => /display:\s*none/.test(rule[2] ?? ""))
      .map((rule) => (rule[1] ?? "").trim())
      .filter((selector) => !selector.includes(".admin-bar"));
    expect(hiding).toEqual([]);
  });
});
