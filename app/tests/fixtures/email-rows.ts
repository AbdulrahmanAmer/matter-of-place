import { readFileSync } from "node:fs";
import { z } from "zod";
import { emailTemplateSchema, type EmailBlock } from "../../src/domain/email";

// The email rows as the migrations leave them, read from the migration files: what a template file's definition must
// equal, since what is sent is always the row (invariant 1). A row is inserted once (B5's seed, then each later key's
// own migration); the email houses migration of 2026-10-15 moves a row that still holds its seed to the copy of its
// file, and adds two variables.

interface StoredRow {
  key: string;
  class: string;
  subject: string;
  preheader: string;
  blocks: EmailBlock[];
  variables: string[];
}

export const HOUSES_MIGRATION = "20261015094613_email_houses.sql";

const migration = (name: string): string =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");

const unquote = (value: string | undefined): string => (value ?? "").replaceAll("''", "'");

const INSERTED =
  /\(\s*'(\w+)',\s*'(\w+)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'(\[[\s\S]*?\])',\s*'\{([^}]*)\}',\s*(?:true|false)\s*\)/g;

/** The rows an insert migration seeds, in its order. */
export function inserted(name: string): StoredRow[] {
  return [...migration(name).matchAll(INSERTED)].map(
    ([, key, kind, subject, preheader, body, variables]) => ({
      key: emailTemplateSchema.shape.key.parse(key),
      class: kind ?? "",
      subject: unquote(subject),
      preheader: unquote(preheader),
      blocks: emailTemplateSchema.shape.body.parse(JSON.parse(unquote(body))),
      variables: (variables ?? "").split(",").filter((name) => name !== ""),
    }),
  );
}

const copy = z.object({
  subject: z.string(),
  preheader: z.string(),
  body: emailTemplateSchema.shape.body,
});

const MOVED = /\('(\w+)', '((?:[^']|'')*)'::jsonb,\s*'((?:[^']|'')*)'::jsonb\)/g;
// A statement at the start of a line: the `-- down:` comment names the old lists in the same words.
const VARIABLES =
  /^update public\.email_templates set variables = '\{([^}]*)\}' where key = '(\w+)';$/gm;

/** A row as it stands after the email houses migration, when it still held `seed` before it. */
export function afterHouses(seed: StoredRow): StoredRow {
  const sql = migration(HOUSES_MIGRATION);
  const moved = [...sql.matchAll(MOVED)].find(([, key]) => key === seed.key);
  const variables = [...sql.matchAll(VARIABLES)].find(([, , key]) => key === seed.key);
  const next = moved === undefined ? undefined : copy.parse(JSON.parse(unquote(moved[3])));
  const before = moved === undefined ? undefined : copy.parse(JSON.parse(unquote(moved[2])));
  if (before !== undefined) {
    // The migration moves a row only from its seed, so the seed it names must be the one this row was inserted with.
    if (
      JSON.stringify(before) !==
      JSON.stringify({ subject: seed.subject, preheader: seed.preheader, body: seed.blocks })
    ) {
      throw new Error(`${seed.key}: the email houses migration names another seed`);
    }
  }
  return {
    ...seed,
    ...(next === undefined
      ? {}
      : { subject: next.subject, preheader: next.preheader, blocks: next.body }),
    ...(variables === undefined ? {} : { variables: (variables[1] ?? "").split(",") }),
  };
}
