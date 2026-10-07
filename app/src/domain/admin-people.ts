import { z } from "zod";
import { adminPageAnswer, adminPageSchema } from "./admin-page.ts";
import {
  acceptedStates,
  editorialStates,
  exposurePackages,
  submissionStates,
  submitterKinds,
} from "./contracts.ts";

// Screens 26 and 27 (B7 invariant 23, S55): every person who submitted, one `contacts` row each. API JSON is the
// snake_case row shape of the generated types.

const uuid = z.string().uuid();

/** `GET /api/admin/people`. The cursor names the last row of the page before: its id and its name, up to 200 characters. */
export const peopleListInputSchema = adminPageSchema.extend({
  cursor: z.string().min(1).max(240).optional(),
  /** Name, email or brokerage; `people_list` matches it as plain text. */
  search: z.string().max(200).optional(),
  kind: z.enum(submitterKinds).optional(),
});

export type PeopleListInput = z.infer<typeof peopleListInputSchema>;

/** One row of `people_list`. */
export const personListRowSchema = z.object({
  id: uuid,
  name: z.string(),
  kind: z.enum(submitterKinds),
  brokerage: z.string().nullable(),
  email: z.string(),
  requests: z.number().int(),
  accepted: z.number().int(),
  published: z.number().int(),
  last_activity_at: z.string(),
});

export type PersonListRow = z.infer<typeof personListRowSchema>;

export const peopleListSchema = adminPageAnswer(personListRowSchema);

/** The path parameter of `GET /api/admin/people/:id`. */
export const personIdInputSchema = z.object({ id: uuid });

/** `PUT /api/admin/people/:id/notes`: the whole text, and the `updated_at` the editor started from (409 `stale`). */
export const personNotesInputSchema = personIdInputSchema.extend({
  notes: z.string().max(5000),
  expected_updated_at: z.string().min(1),
});

export type PersonNotesInput = z.infer<typeof personNotesInputSchema>;

export const personNotesAnswerSchema = z.object({ updated_at: z.string() });

/** `GET /api/admin/people/:id`: the six sections of screen 27, each newest first and at most 100 rows. */
export const personDetailSchema = z.object({
  contact: z.object({
    id: uuid,
    kind: z.enum(submitterKinds),
    name: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    brokerage: z.string().nullable(),
    notes: z.string().nullable(),
    updated_at: z.string(),
  }),
  requests: z.array(
    z.object({
      id: uuid,
      address: z.string(),
      city: z.string(),
      state: z.enum(acceptedStates),
      workflow_state: z.enum(submissionStates),
      received_at: z.string(),
    }),
  ),
  properties: z.array(
    z.object({
      id: uuid,
      title: z.string(),
      slug: z.string(),
      editorial_state: z.enum(editorialStates),
      first_published_at: z.string().nullable(),
    }),
  ),
  payments: z.array(
    z.object({
      id: uuid,
      invoice_number: z.string().nullable(),
      product: z.enum(exposurePackages),
      amount: z.number(),
      currency: z.string(),
      status: z.string(),
      issued_at: z.string().nullable(),
      paid_at: z.string().nullable(),
    }),
  ),
  emails: z.array(
    z.object({
      id: uuid,
      template_key: z.string(),
      status: z.string(),
      sent_at: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
  inquiries: z.array(
    z.object({
      id: uuid,
      received_at: z.string(),
      intent: z.string(),
      state: z.string(),
      subject_title: z.string().nullable(),
    }),
  ),
});

export type PersonDetail = z.infer<typeof personDetailSchema>;
