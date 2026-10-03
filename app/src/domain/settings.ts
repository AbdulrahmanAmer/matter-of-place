import { z } from "zod";

// `settings.site`: the legal identity every surface reads (B16). The shape is the jsonb value B2 seeds; the keys and
// the API JSON are the same names (G-004), so a leaf is added here, in the seed and in the field specs together.

const unset = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/** A leaf: blank or missing becomes null, anything else must pass `inner`. */
const leaf = (inner: z.ZodType<string, z.ZodTypeDef, string>) =>
  z.preprocess(unset, inner.nullable()).default(null);

const isHttpsOn = (value: string, host: string, pathPrefix: string): boolean => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    return false;
  }
  const onHost = url.hostname === host || url.hostname.endsWith(`.${host}`);
  return onHost && url.pathname.startsWith(pathPrefix) && url.pathname.length > pathPrefix.length;
};

const emailLeaf = leaf(z.string().email().max(254));
const urlOn = (host: string, pathPrefix: string, message: string) =>
  leaf(z.string().refine((value) => isHttpsOn(value, host, pathPrefix), message));

export const siteSettingsSchema = z.object({
  contact: z
    .object({
      email: emailLeaf,
      phone: leaf(z.string().min(6).max(30).regex(/\d/, "Include at least one digit")),
      privacy_email: emailLeaf,
    })
    .default({}),
  legal: z
    .object({
      entity: leaf(z.string().min(3).max(200)),
      address: leaf(z.string().min(5).max(400)),
    })
    .default({}),
  social: z
    .object({
      instagram: urlOn("instagram.com", "/", "Use an https address on instagram.com"),
      x: urlOn("x.com", "/", "Use an https address on x.com"),
      linkedin: urlOn("linkedin.com", "/company/", "Use an https address on linkedin.com/company/"),
    })
    .default({}),
});

export type SiteSettings = z.infer<typeof siteSettingsSchema>;

export const emptySiteSettings: SiteSettings = siteSettingsSchema.parse({});

/** The values that are set, trimmed and in order: nothing renders for a null or blank one (invariant 2). */
export function presentLines(...values: readonly (string | null | undefined)[]): string[] {
  return values.flatMap((value) => {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === "" ? [] : [trimmed];
  });
}

/** The mailbox for privacy requests: its own address when set, otherwise the contact email. */
export function privacyLines(site: SiteSettings): string[] {
  return presentLines(site.contact.privacy_email ?? site.contact.email);
}

type SiteFieldKey =
  | "contact.email"
  | "contact.privacy_email"
  | "contact.phone"
  | "legal.entity"
  | "legal.address"
  | "social.instagram"
  | "social.x"
  | "social.linkedin";

export interface SiteFieldSpec {
  key: SiteFieldKey;
  label: string;
  help: string;
  /** Required before launch; `siteReadiness` lists the ones still missing. */
  required: boolean;
  input: "email" | "tel" | "text" | "textarea" | "url";
}

/** The fields of screen 24's identity section, in display order. */
export const siteFieldSpecs: readonly SiteFieldSpec[] = [
  {
    key: "contact.email",
    label: "Contact email",
    help: "Shown on the contact page and used as the reply address of our emails.",
    required: true,
    input: "email",
  },
  {
    key: "contact.privacy_email",
    label: "Privacy request email",
    help: "Where privacy requests are sent when the form cannot be used. Falls back to the contact email.",
    required: false,
    input: "email",
  },
  {
    key: "contact.phone",
    label: "Contact phone",
    help: "Shown on the contact page and on invoices.",
    required: false,
    input: "tel",
  },
  {
    key: "legal.entity",
    label: "Legal entity",
    help: "Shown on the legal page and on every invoice.",
    required: true,
    input: "text",
  },
  {
    key: "legal.address",
    label: "Registered address",
    help: "The postal address printed on the legal page, on invoices and in the newsletter footer.",
    required: true,
    input: "textarea",
  },
  {
    key: "social.instagram",
    label: "Instagram URL",
    help: "The full https address of our Instagram profile.",
    required: false,
    input: "url",
  },
  {
    key: "social.x",
    label: "X URL",
    help: "The full https address of our X profile.",
    required: false,
    input: "url",
  },
  {
    key: "social.linkedin",
    label: "LinkedIn URL",
    help: "The full https address of our LinkedIn company page.",
    required: false,
    input: "url",
  },
];
