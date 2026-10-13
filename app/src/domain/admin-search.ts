import { z } from "zod";

// The admin's one search box (W3, admin pass): requests, people, properties, inquiries, invoices and stories at once,
// each group only for an actor who may list it. `GET /api/admin/search?q=`.

export const adminSearchKinds = [
  "requests",
  "people",
  "properties",
  "inquiries",
  "invoices",
  "stories",
] as const;
export type AdminSearchKind = (typeof adminSearchKinds)[number];

export const adminSearchKindLabels: Record<AdminSearchKind, string> = {
  requests: "Requests",
  people: "People",
  properties: "Properties",
  inquiries: "Inquiries",
  invoices: "Invoices",
  stories: "Stories",
};

export const adminSearchInputSchema = z.object({
  q: z.string().trim().min(2).max(100),
});

const hitSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  href: z.string(),
});
export type AdminSearchHit = z.infer<typeof hitSchema>;

export const adminSearchAnswerSchema = z.object({
  groups: z.array(z.object({ kind: z.enum(adminSearchKinds), items: z.array(hitSchema) })),
});
export type AdminSearchAnswer = z.infer<typeof adminSearchAnswerSchema>;
