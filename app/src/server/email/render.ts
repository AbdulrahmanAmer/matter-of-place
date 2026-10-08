import { render } from "@react-email/render";
import { createElement } from "react";
import { z } from "zod";
import { emailBlockSchema, type EmailBlock, type EmailTemplateRow } from "../../domain/email.ts";
import { Message, SIGNATURE } from "../../templates/email/blocks.tsx";
import { definitions } from "../../templates/email/index.ts";
import { footerLines, type TextParts } from "../../templates/email/layout.tsx";
import { NonRetryableError } from "../jobs/types.ts";
import type { SiteContext } from "./context.ts";

/** The part of a template row that is drawn. What is sent is always the row, never its definition (invariant 1). */
export type RenderRow = Pick<EmailTemplateRow, "key" | "subject" | "preheader" | "body">;

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

const body = z.array(emailBlockSchema);

const FAILED_RENDER = "<!--$!-->";

const VARIABLE = /\{\{([A-Za-z0-9_]+)\}\}/g;

/** Replaces each `{{name}}`; a name with no value is `missing_variable:<name>`, so nothing unreplaced is sent. */
export function interpolate(text: string, variables: Record<string, string>): string {
  return text.replace(VARIABLE, (_match, name: string) => {
    const value = Object.hasOwn(variables, name) ? variables[name] : undefined;
    if (value === undefined) throw new NonRetryableError(`missing_variable:${name}`);
    return value;
  });
}

// A header line has no line breaks, whatever a variable held.
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

const blank = (text: string): boolean => text.trim() === "";

/**
 * A link built from a variable goes only to the site itself over https: a stored address, a name or a message can
 * never turn a button into a link to somewhere else.
 */
function siteLink(template: string, url: string, site: SiteContext): string {
  if (!template.includes("{{")) return url;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new NonRetryableError("url_off_site");
  }
  if (target.protocol !== "https:" || target.origin !== new URL(site.siteUrl).origin) {
    throw new NonRetryableError("url_off_site");
  }
  return url;
}

/** Interpolates one block and drops it when nothing is left to say (a note the admin did not write). */
function resolveBlock(
  block: EmailBlock,
  variables: Record<string, string>,
  site: SiteContext,
): EmailBlock | null {
  const fill = (text: string): string => interpolate(text, variables);
  switch (block.type) {
    case "heading":
    case "paragraph": {
      const text = fill(block.text);
      return blank(text) ? null : { ...block, text };
    }
    case "button": {
      const label = fill(block.label);
      const url = fill(block.url);
      if (blank(label) || blank(url)) return null;
      return { type: "button", label, url: siteLink(block.url, url, site) };
    }
    case "facts": {
      const rows = block.rows
        .map((row) => ({ label: fill(row.label), value: fill(row.value) }))
        .filter((row) => !blank(row.value));
      return rows.length === 0 ? null : { type: "facts", rows };
    }
    case "signature":
      return block.text === undefined ? block : { type: "signature", text: fill(block.text) };
  }
}

const LINE = "\n";
const GAP = "\n\n";

/**
 * The plain-text part, written from the resolved blocks. It is not converted from the HTML: the conversion library cost
 * more CPU than the render itself (measured in docs/runbooks/email.md), and the preview runs inside a Worker.
 */
function plainText(
  blocks: readonly EmailBlock[],
  site: SiteContext,
  { lead, trail }: TextParts,
): string {
  const parts = blocks.map((block) => {
    switch (block.type) {
      case "heading":
      case "paragraph":
        return block.text;
      case "button":
        return `${block.label}: ${block.url}`;
      case "facts":
        return block.rows.map((row) => `${row.label}: ${row.value}`).join(LINE);
      case "signature":
        return block.text ?? SIGNATURE;
    }
  });
  return `${[...lead, ...parts, footerLines(site).join(LINE), ...trail].join(GAP)}${LINE}`;
}

/** Only a string value is text: an object such as the `block` of a standalone email is drawn by its template file. */
const textVariables = (variables: Readonly<Record<string, unknown>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(variables).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

/**
 * The one renderer (invariant 2): preview, test send and send all come through here. Subject, preheader and blocks come
 * from `row`; the template file of `row.key` only draws them, and a row whose key has no template file is drawn in
 * the plain shell. `variables` reach that file unchanged; only the string ones are interpolated, and a row with no
 * blocks renders only when its file draws its own content.
 */
export async function renderTemplate(
  row: RenderRow,
  variables: Readonly<Record<string, unknown>>,
  site: SiteContext,
): Promise<RenderedEmail> {
  const parsed = body.safeParse(row.body);
  if (!parsed.success) throw new NonRetryableError("template_body_invalid");
  const file = definitions.find((candidate) => candidate.definition.key === row.key);
  const Email = file?.Email ?? Message;
  if (parsed.data.length === 0 && Email === Message)
    throw new NonRetryableError("template_body_invalid");
  const text = textVariables(variables);
  const subject = oneLine(interpolate(row.subject, text));
  const preheader = oneLine(interpolate(row.preheader, text));
  const blocks = parsed.data.flatMap((block) => resolveBlock(block, text, site) ?? []);
  // A component that throws ends two ways: the Node build of `render` resolves with a client-render fallback holding
  // its stack, the edge build the Worker bundles rejects. Neither is mail, and neither is worth a retry.
  const html = await render(
    createElement(Email, { title: subject, preheader, blocks, site, variables }),
  ).catch((cause: unknown) => {
    throw Object.assign(new NonRetryableError("template_render_failed"), { cause });
  });
  if (html.includes(FAILED_RENDER)) throw new NonRetryableError("template_render_failed");
  const parts = file?.textParts?.(variables) ?? { lead: [], trail: [] };
  return { subject, preheader, html, text: plainText(blocks, site, parts) };
}
