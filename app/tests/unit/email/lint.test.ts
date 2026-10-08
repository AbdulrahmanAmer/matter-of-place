import { describe, expect, it } from "vitest";
import { z } from "zod";
import { sampleVariables, type EmailTemplateKey } from "../../../src/domain/email";
import type { SiteContext } from "../../../src/server/email/context";
import { renderTemplate } from "../../../src/server/email/render";
import { standaloneText } from "../../../src/server/newsletter/standalone";
import { definitionRow, definitions } from "../../../src/templates/email/index";
import { themeHex } from "../../../src/templates/theme.gen";
import { lintEmail } from "../../../scripts/lib/email-lint";

const site: SiteContext = {
  siteUrl: "https://matterofplace.com",
  entity: null,
  address: null,
  contact: { email: null },
};

interface Mail {
  html: string;
  text: string;
}

const rendered = new Map<string, Mail>();
const standaloneBlock = z
  .object({ title: z.string(), deck: z.string(), link: z.string() })
  .parse(sampleVariables("standalone")["block"]);

for (const { definition } of definitions) {
  const { html, text } = await renderTemplate(
    definitionRow(definition),
    sampleVariables(definition.key),
    site,
  );
  // A standalone email is sent with its own plain-text part, which holds the block's link and the unsubscribe address.
  rendered.set(definition.key, {
    html,
    text: definition.key === "standalone" ? standaloneText(standaloneBlock, site) : text,
  });
}

const mailOf = (key: EmailTemplateKey): Mail => {
  const mail = rendered.get(key);
  if (mail === undefined) throw new Error(`no render for ${key}`);
  return mail;
};

const rulesOf = (mail: Mail, key?: string): string[] =>
  lintEmail(mail.html, mail.text, key).map((finding) => finding.rule);

describe("lintEmail", () => {
  it.each(definitions.map((entry) => entry.definition.key))("%s has no finding", (key) => {
    const { html, text } = mailOf(key);
    expect(lintEmail(html, text, key)).toEqual([]);
  });

  const BUTTON = /href="https:\/\/matterofplace\.com\/api[^"]*"/;
  const URL_IN_TEXT = "https://matterofplace.com/api/public/subscribers/confirm?token=sample-token";
  const fixtures: {
    name: string;
    rule: string;
    key: EmailTemplateKey;
    change: (mail: Mail) => Mail;
  }[] = [
    {
      name: "script",
      rule: "forbidden-tag",
      key: "received",
      change: (m) => ({ ...m, html: m.html.replace("</body>", "<script>1</script></body>") }),
    },
    {
      name: "iframe",
      rule: "forbidden-tag",
      key: "received",
      change: (m) => ({ ...m, html: m.html.replace("</body>", "<iframe></iframe></body>") }),
    },
    {
      name: "linked stylesheet",
      rule: "stylesheet",
      key: "received",
      change: (m) => ({
        ...m,
        html: m.html.replace(
          "</head>",
          '<link rel="stylesheet" href="https://matterofplace.com/a.css"/></head>',
        ),
      }),
    },
    {
      name: "@import",
      rule: "stylesheet",
      key: "received",
      change: (m) => ({
        ...m,
        html: m.html.replace("</head>", "<style>@import url(a.css);</style></head>"),
      }),
    },
    {
      name: "image without alt",
      rule: "img-alt",
      key: "received",
      change: (m) => ({ ...m, html: m.html.replace('alt=""', "") }),
    },
    {
      name: "image with relative src",
      rule: "img-src",
      key: "received",
      change: (m) => ({
        ...m,
        html: m.html.replace(
          "https://matterofplace.com/apple-touch-icon.png",
          "/apple-touch-icon.png",
        ),
      }),
    },
    {
      name: "image with no width",
      rule: "img-width",
      key: "received",
      change: (m) => ({ ...m, html: m.html.replace('width="36"', 'width="auto"') }),
    },
    {
      name: "http link",
      rule: "link-href",
      key: "newsletter_confirm",
      change: (m) => ({ ...m, html: m.html.replace(BUTTON, 'href="http://matterofplace.com/x"') }),
    },
    {
      name: "javascript link",
      rule: "link-href",
      key: "newsletter_confirm",
      change: (m) => ({ ...m, html: m.html.replace(BUTTON, 'href="javascript:alert(1)"') }),
    },
    {
      name: "link with no text",
      rule: "link-text",
      key: "received",
      change: (m) => ({
        ...m,
        html: m.html.replace("</body>", '<a href="https://matterofplace.com"> </a></body>'),
      }),
    },
    {
      name: "no language",
      rule: "lang",
      key: "received",
      change: (m) => ({ ...m, html: m.html.replace('lang="en"', 'lang="fr"') }),
    },
    {
      name: "empty title",
      rule: "title",
      key: "received",
      change: (m) => ({ ...m, html: m.html.replace(/<title>[^<]*<\/title>/, "<title></title>") }),
    },
    {
      name: "container 700 px",
      rule: "container-width",
      key: "received",
      change: (m) => ({ ...m, html: m.html.replaceAll("max-width:600px", "max-width:700px") }),
    },
    {
      name: "table with no role",
      rule: "table-role",
      key: "received",
      change: (m) => ({
        ...m,
        html: m.html.replace("</body>", "<table><tbody><tr><td>x</td></tr></tbody></table></body>"),
      }),
    },
    {
      name: "colour outside the theme",
      rule: "hex",
      key: "received",
      change: (m) => ({ ...m, html: m.html.replace(themeHex.accent, "#ff0000") }),
    },
    {
      name: "unreplaced variable",
      rule: "placeholder-text",
      key: "received",
      change: (m) => ({ ...m, html: m.html.replace("Thank you", "Thank you {{name}}") }),
    },
    {
      name: "undefined in the text",
      rule: "placeholder-text",
      key: "received",
      change: (m) => ({ ...m, text: `${m.text}undefined` }),
    },
    {
      name: "em dash",
      rule: "em-dash",
      key: "received",
      change: (m) => ({ ...m, html: m.html.replace("Thank you", "Thank you —") }),
    },
    {
      name: "long preheader",
      rule: "preheader",
      key: "repermission",
      change: (m) => ({
        ...m,
        html: m.html.replace("One click keeps you on the list.", "x".repeat(111)),
      }),
    },
    {
      name: "over 102,000 bytes",
      rule: "size",
      key: "received",
      change: (m) => ({
        ...m,
        html: m.html.replace("</body>", `<p>${"a".repeat(102_000)}</p></body>`),
      }),
    },
    {
      name: "empty text part",
      rule: "text-empty",
      key: "received",
      change: (m) => ({ ...m, text: "  " }),
    },
    {
      name: "tags in the text part",
      rule: "text-tags",
      key: "received",
      change: (m) => ({ ...m, text: `${m.text}<b>bold</b>` }),
    },
    {
      name: "button address missing from text",
      rule: "text-url",
      key: "newsletter_confirm",
      change: (m) => ({ ...m, text: m.text.replace(URL_IN_TEXT, "") }),
    },
  ];

  it.each(fixtures)("fires $rule on $name", ({ rule, key, change }) => {
    expect(rulesOf(mailOf(key), key)).toEqual([]);
    expect(rulesOf(change(mailOf(key)), key)).toContain(rule);
  });

  const PLACEHOLDER = "{{{RESEND_UNSUBSCRIBE_URL}}}";
  const AUTH = "{{ .SiteURL }}/admin/auth/confirm?token_hash={{ .TokenHash }}&type=email";

  const withHref = (key: EmailTemplateKey, href: string): Mail => {
    const { html, text } = mailOf(key);
    return {
      html: html.replace(BUTTON, `href="${href.replaceAll("&", "&amp;")}"`),
      text: text.replace(URL_IN_TEXT, href),
    };
  };

  it("lets only standalone carry the Resend placeholder", () => {
    const mail = withHref("newsletter_confirm", PLACEHOLDER);
    expect(rulesOf(mail, "standalone")).toEqual([]);
    expect(rulesOf(mail, "newsletter_confirm")).toContain("link-href");
    expect(rulesOf(mail)).toContain("link-href");
  });

  it("lets only the two auth templates carry the Go-template link, and only that link", () => {
    const mail = withHref("newsletter_confirm", AUTH);
    expect(rulesOf(mail, "auth_magic_link")).toEqual([]);
    expect(rulesOf(mail, "auth_invite")).toEqual([]);
    expect(rulesOf(mail, "newsletter_confirm")).toContain("link-href");
    const other = withHref("newsletter_confirm", "{{ .SiteURL }}/somewhere/else");
    expect(rulesOf(other, "auth_magic_link")).toContain("link-href");
  });
});
