import type { ZodIssue } from "zod";
import { emailTemplateSchema } from "../../domain/automation";
import {
  usedVariables,
  variablesByKey,
  type EmailBlock,
  type EmailTemplateKey,
} from "../../domain/email";
import type { TemplatePatch, TemplateRow } from "./automation-queries";

// The template as the person is editing it, and the checks the form can make before the server is asked. The server
// stays the check: it parses the same schema (`emailTemplateSchema`) and the renderer refuses what is left.

export type Draft = TemplatePatch & { body: EmailBlock[] };

export type BlockType = EmailBlock["type"];

export const blockLabels: Record<BlockType, string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  button: "Button",
  facts: "Facts",
  signature: "Signature",
};

export const blockTypes = Object.keys(blockLabels).filter(
  (type): type is BlockType => type in blockLabels,
);

/** The most blocks a template holds; the same bound as `emailTemplateSchema`. */
export const maxBlocks = 40;

/** The most rows one facts block holds; the same bound as `emailBlockSchema`. */
export const maxFactRows = 12;

export function draftOf(
  row: Pick<TemplateRow, "subject" | "preheader" | "enabled" | "body">,
): Draft {
  return {
    subject: row.subject,
    preheader: row.preheader,
    enabled: row.enabled,
    body: [...row.body],
  };
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** An empty block of `type`, which the form shows as "Required" until the person writes in it. */
export function newBlock(type: BlockType): EmailBlock {
  switch (type) {
    case "heading":
      return { type, text: "", level: 2 };
    case "paragraph":
      return { type, text: "" };
    case "button":
      return { type, label: "", url: "" };
    case "facts":
      return { type, rows: [{ label: "", value: "" }] };
    case "signature":
      return { type };
  }
}

/** The distinct `{{variable}}` names of the subject, the preheader and the blocks. */
export function namedVariables(draft: Draft): string[] {
  return usedVariables([
    { type: "paragraph", text: draft.subject },
    { type: "paragraph", text: draft.preheader },
    ...draft.body,
  ]);
}

/**
 * The variables a draft names that its template cannot supply. The renderer stops on each of them
 * (`missing_variable:<name>`), so the email would not go out.
 */
export function missingVariables(key: EmailTemplateKey, draft: Draft): string[] {
  const allowed: readonly string[] = variablesByKey[key];
  return namedVariables(draft).filter((name) => !allowed.includes(name));
}

export interface DraftErrors {
  subject?: string;
  preheader?: string;
  /** About the list as a whole: no blocks, or too many. */
  body?: string;
  /** Per block index, the first message of that block. */
  blocks: Record<number, string>;
}

function messageOf(issue: ZodIssue): string {
  if (issue.code === "too_small" && issue.type === "string") return "Required";
  if (issue.code === "too_big" && issue.type === "string") {
    return `At most ${String(issue.maximum)} characters`;
  }
  if (issue.code === "too_small" && issue.type === "array") return "Add at least one";
  if (issue.code === "too_big" && issue.type === "array") {
    return `At most ${String(issue.maximum)}`;
  }
  return issue.message;
}

const checked = emailTemplateSchema.pick({
  subject: true,
  preheader: true,
  body: true,
});

/** Everything the form can tell before saving; `ok` is true when nothing is wrong. */
export function checkDraft(draft: Draft): { ok: boolean; errors: DraftErrors } {
  const errors: DraftErrors = { blocks: {} };
  const parsed = checked.safeParse(draft);
  if (parsed.success) return { ok: true, errors };
  for (const issue of parsed.error.issues) {
    const [field, index] = issue.path;
    if (field === "subject") errors.subject ??= messageOf(issue);
    else if (field === "preheader") errors.preheader ??= messageOf(issue);
    else if (typeof index === "number") errors.blocks[index] ??= messageOf(issue);
    else errors.body ??= messageOf(issue);
  }
  return { ok: false, errors };
}
