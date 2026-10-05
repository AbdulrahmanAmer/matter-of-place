// The HTML email lint (GQ-04). Hand-written on purpose: no third-party linter, so it runs offline inside
// `bun run check` and in the gates of the auth templates and `email:shots`. It reads the rendered HTML as text, so a
// rule that the renderer stops honouring is a finding, not a silent regression.
import { themeHex } from "../../src/templates/theme.gen.ts";

export interface Finding {
  rule: string;
  message: string;
}

const FORBIDDEN_TAGS = ["script", "iframe", "form", "video", "object"];
const RESEND_PLACEHOLDER = "{{{RESEND_UNSUBSCRIBE_URL}}}";
const AUTH_HREF = "{{ .SiteURL }}/admin/auth/confirm?token_hash={{ .TokenHash }}&type=";
const AUTH_TOKEN = /\{\{ \.(?:SiteURL|TokenHash|RedirectTo) \}\}/g;
const MAX_PREHEADER = 110;
const MAX_BYTES = 102_000;
const PREHEADER = /<div[^>]*data-skip-in-text="true"[^>]*>([^<]*)(?:<div>[^<]*<\/div>)?<\/div>/;
const THEME_HEX = new Set<string>(Object.values(themeHex));

const isAuth = (key: string | undefined): boolean =>
  key === "auth_magic_link" || key === "auth_invite";

const finding = (rule: string, message: string): Finding => ({ rule, message });

const decode = (value: string): string =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");

interface Tag {
  name: string;
  attrs: Map<string, string>;
}

/** Every opening tag with its attributes. Conditional comments are dropped first: their tags are for Outlook only. */
function tagsOf(html: string): Tag[] {
  const bare = html.replace(/<!--[\s\S]*?-->/g, "");
  return [...bare.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)].map((match) => ({
    name: (match[1] ?? "").toLowerCase(),
    attrs: new Map(
      [...(match[2] ?? "").matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g)].map((attr) => [
        (attr[1] ?? "").toLowerCase(),
        decode(attr[2] ?? ""),
      ]),
    ),
  }));
}

/** The words a reader sees: no head, no styles, no hidden preheader, no tags. */
function visibleText(html: string): string {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, "")
      .replace(PREHEADER, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

// Only these may be linked, which leaves no way for a `javascript:` address.
const hrefAllowed = (href: string, key: string | undefined): boolean =>
  /^(?:https:\/\/|mailto:)/.test(href) ||
  (key === "standalone" && href === RESEND_PLACEHOLDER) ||
  (isAuth(key) && href.startsWith(AUTH_HREF));

function forbiddenMarkup(tags: Tag[], html: string): Finding[] {
  return [
    ...tags
      .filter((tag) => FORBIDDEN_TAGS.includes(tag.name))
      .map((tag) => finding("forbidden-tag", `<${tag.name}> is not allowed in an email`)),
    ...tags
      .filter((tag) => tag.name === "link" && /stylesheet/i.test(tag.attrs.get("rel") ?? ""))
      .map(() => finding("stylesheet", "a linked stylesheet is not allowed")),
    ...(/@import/.test(html) ? [finding("stylesheet", "@import is not allowed")] : []),
  ];
}

function imageFindings(tags: Tag[]): Finding[] {
  return tags
    .filter((tag) => tag.name === "img")
    .flatMap((tag) => {
      const src = tag.attrs.get("src") ?? "";
      return [
        ...(tag.attrs.has("alt") ? [] : [finding("img-alt", `<img src="${src}"> has no alt`)]),
        ...(/^https:\/\//.test(src)
          ? []
          : [finding("img-src", `<img src="${src}"> is not an absolute https address`)]),
        ...(/^\d+$/.test(tag.attrs.get("width") ?? "")
          ? []
          : [finding("img-width", `<img src="${src}"> has no numeric width`)]),
      ];
    });
}

function linkFindings(html: string, key: string | undefined): Finding[] {
  const anchors = [
    ...html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g),
  ];
  return anchors.flatMap((anchor) => {
    const href = decode(/\bhref="([^"]*)"/.exec(anchor[1] ?? "")?.[1] ?? "");
    return [
      ...(hrefAllowed(href, key)
        ? []
        : [finding("link-href", `<a href="${href}"> is not an https or mailto address`)]),
      ...(visibleText(anchor[2] ?? "") === ""
        ? [finding("link-text", `<a href="${href}"> has no visible text`)]
        : []),
    ];
  });
}

function documentFindings(html: string): Finding[] {
  return [
    ...(/<html\b[^>]*\blang="en"/.test(html)
      ? []
      : [finding("lang", '<html lang="en"> is missing')]),
    ...(/<title[^>]*>\s*[^<\s][^<]*<\/title>/.test(html)
      ? []
      : [finding("title", "the <title> is missing or empty")]),
    ...(/max-width:\s*600px/.test(html)
      ? []
      : [finding("container-width", "the outer container does not declare max-width: 600px")]),
    ...(new TextEncoder().encode(html).length > MAX_BYTES
      ? [finding("size", `the HTML is larger than ${String(MAX_BYTES)} bytes, which Gmail clips`)]
      : []),
  ];
}

/** A table is layout (`role="presentation"`) or data (it has a `<th>`); anything else reads badly in a screen reader. */
function tableFindings(html: string): Finding[] {
  const open: { presentation: boolean; header: boolean }[] = [];
  const findings: Finding[] = [];
  for (const match of html.matchAll(/<table\b([^>]*)>|<\/table>|<th\b/g)) {
    if (match[0] === "</table>") {
      const table = open.pop();
      if (table !== undefined && !table.presentation && !table.header) {
        findings.push(
          finding("table-role", 'a <table> has neither role="presentation" nor a <th>'),
        );
      }
    } else if (match[0].startsWith("<th")) {
      const table = open.at(-1);
      if (table !== undefined) table.header = true;
    } else {
      open.push({ presentation: /\brole="presentation"/.test(match[1] ?? ""), header: false });
    }
  }
  return findings;
}

function colourFindings(html: string): Finding[] {
  const styles = [
    ...[...html.matchAll(/\bstyle="([^"]*)"/g)].map((match) => match[1] ?? ""),
    ...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1] ?? ""),
  ];
  return styles
    .flatMap((style) => style.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [])
    .filter((hex) => !THEME_HEX.has(hex.toLowerCase()))
    .map((hex) => finding("hex", `${hex} is not a colour of theme.gen.ts`));
}

function wordingFindings(html: string, text: string, key: string | undefined): Finding[] {
  const allowed = (value: string): string => {
    if (key === "standalone") return value.replaceAll(RESEND_PLACEHOLDER, "");
    return isAuth(key) ? value.replace(AUTH_TOKEN, "") : value;
  };
  const shown = [allowed(visibleText(html)), allowed(text)];
  return [
    ...(shown.some((value) => /\{\{|\bundefined\b|\bnull\b|\[object Object\]/.test(value))
      ? [finding("placeholder-text", "a placeholder, undefined, null or [object Object] shows")]
      : []),
    ...(`${html}${text}`.includes("—") ? [finding("em-dash", "an em dash is in the email")] : []),
  ];
}

function preheaderFindings(html: string): Finding[] {
  const length = (PREHEADER.exec(html)?.[1] ?? "").trim().length;
  return length > MAX_PREHEADER
    ? [
        finding(
          "preheader",
          `the preheader is ${String(length)} characters, over ${String(MAX_PREHEADER)}`,
        ),
      ]
    : [];
}

function textPartFindings(html: string, text: string): Finding[] {
  const hrefs = tagsOf(html)
    .filter((tag) => tag.name === "a")
    .map((tag) => tag.attrs.get("href") ?? "")
    .filter((href) => href !== "" && !href.startsWith("mailto:"));
  return [
    ...(text.trim() === "" ? [finding("text-empty", "the plain-text part is empty")] : []),
    ...(/<[a-zA-Z/!][^>]*>/.test(text)
      ? [finding("text-tags", "the plain-text part holds tags")]
      : []),
    ...hrefs
      .filter((href) => !text.includes(href))
      .map((href) => finding("text-url", `the plain-text part does not hold ${href}`)),
  ];
}

/**
 * Findings for one rendered email; none means it may go out. `key` is the template's key: only `standalone` may carry
 * Resend's unsubscribe placeholder, and only the two auth templates may carry Supabase's Go-template link.
 */
export function lintEmail(html: string, text: string, key?: string): Finding[] {
  const tags = tagsOf(html);
  return [
    ...forbiddenMarkup(tags, html),
    ...imageFindings(tags),
    ...linkFindings(html, key),
    ...documentFindings(html),
    ...tableFindings(html),
    ...colourFindings(html),
    ...wordingFindings(html, text, key),
    ...preheaderFindings(html),
    ...textPartFindings(html, text),
  ];
}
