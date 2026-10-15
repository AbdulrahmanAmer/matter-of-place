// Writes the two Supabase Auth emails that `config.toml` points at (B5 step 8): `bun run scripts/build-auth-templates.ts`.
// Their link is a Go template that Supabase fills when it sends. It carries the token hash to our own confirm page,
// never `ConfirmationURL`, so a link opened on another device, or fetched first by a mail scanner, still signs in
// (API-01). Both are moments, so both are drawn in Threshold (operator, 2026-10-15), and both pass the email lint
// before either is written.
import { render } from "@react-email/render";
import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { legalAddress, parentCompany } from "../src/config/legal-identity.ts";
import type { EmailBlock } from "../src/domain/email.ts";
import { Threshold } from "../src/templates/email/house/threshold.tsx";
import { footerLines } from "../src/templates/email/layout.tsx";
import { lintEmail } from "./lib/email-lint.ts";

const CONFIRM = "{{ .SiteURL }}/admin/auth/confirm?token_hash={{ .TokenHash }}&type=";
const NEXT = "&next={{ .RedirectTo }}";

// A static file cannot read `settings.site`, so the colophon names the legal issuer and its postal address from the one
// place they are typed (ruling H83), as every email does. The door, the wordmark and the fonts load from the public
// origin.
const SITE = {
  siteUrl: "https://matterofplace.com",
  entity: parentCompany,
  address: legalAddress,
  contact: { email: null },
};

const AUTH_EMAILS = [
  {
    key: "auth_magic_link",
    file: "supabase/templates/magic-link.html",
    title: "Sign in to Matter of Place",
    lines: ["Sign in", "to the admin."],
    paragraph:
      "Use the button below to sign in to the admin. The link works once and expires after one hour. If you did not ask for it, ignore this email.",
    label: "Sign in",
    type: "email",
  },
  {
    key: "auth_invite",
    file: "supabase/templates/invite.html",
    title: "You have been invited to Matter of Place",
    lines: ["An invitation", "to the admin."],
    paragraph:
      "You have been given access to the Matter of Place admin. Use the button below to accept. If you were not expecting this, ignore this email.",
    label: "Accept the invitation",
    type: "invite",
  },
] as const;

const rendered = await Promise.all(
  AUTH_EMAILS.map(async (email) => {
    const url = `${CONFIRM}${email.type}${NEXT}`;
    const blocks: EmailBlock[] = [
      ...email.lines.map((text): EmailBlock => ({ type: "heading", text })),
      { type: "paragraph", text: email.paragraph },
      { type: "button", label: email.label, url },
    ];
    const html = await render(
      createElement(Threshold, {
        title: email.title,
        preheader: "",
        blocks,
        site: SITE,
        variables: {},
        label: "Admin",
        note: "Sent by the Matter of Place admin.",
      }),
    );
    const text = `${[email.lines.join(" "), email.paragraph, `${email.label}: ${url}`, ...footerLines(SITE)].join("\n\n")}\n`;
    const findings = lintEmail(html, text, email.key).map(
      (finding) => `${email.key}: ${finding.rule} ${finding.message}`,
    );
    return { file: email.file, html, findings };
  }),
);

const findings = rendered.flatMap((email) => email.findings);
if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exit(1);
}
for (const email of rendered) {
  writeFileSync(new URL(`../${email.file}`, import.meta.url), email.html);
  console.log(`wrote ${email.file}`);
}
