import { z } from "zod";

// W7 item 4: what the team remembers, read only in Office: the daily meeting's decisions, the lessons each colleague
// was taught and the history of their instructions. Shared by the admin API and the screen, so it imports nothing
// from the server (G-1200). Every text here was written by an AI colleague: a screen shows it as plain text.

export const decisionStatuses = ["open", "done", "missed"] as const;
export type DecisionStatus = (typeof decisionStatuses)[number];

const decisionSchema = z.object({
  id: z.string().uuid(),
  meeting_on: z.string(),
  owner_slug: z.string(),
  owner_name: z.string(),
  decision: z.string(),
  due_on: z.string(),
  metric: z.string(),
  status: z.enum(decisionStatuses),
  checked_at: z.string().nullable(),
});
export type TeamDecision = z.infer<typeof decisionSchema>;

export const decisionListSchema = z.object({ items: z.array(decisionSchema) });

export const lessonSources = ["decline", "edit", "outcome", "matter"] as const;
export const lessonStatuses = ["active", "retired", "promoted"] as const;

const lessonSchema = z.object({
  id: z.string().uuid(),
  /** Null for a lesson taught to the whole team. */
  agent_slug: z.string().nullable(),
  agent_name: z.string().nullable(),
  trigger: z.string(),
  action: z.string(),
  source: z.enum(lessonSources),
  status: z.enum(lessonStatuses),
  uses: z.number().int().nonnegative(),
  last_used_at: z.string().nullable(),
  created_at: z.string(),
});
export type TeamLesson = z.infer<typeof lessonSchema>;

export const lessonListSchema = z.object({ items: z.array(lessonSchema) });

/** One version of a colleague's instructions, without its text: the text is read on demand (instructionTextSchema). */
const instructionVersionSchema = z.object({
  id: z.string().uuid(),
  agent_slug: z.string(),
  agent_name: z.string(),
  version: z.number().int().nonnegative(),
  reason: z.string(),
  /** The proposal a person approved to make this version, when it came from one. */
  approval_id: z.string().uuid().nullable(),
  created_at: z.string(),
});
export type InstructionVersion = z.infer<typeof instructionVersionSchema>;

export const instructionVersionListSchema = z.object({ items: z.array(instructionVersionSchema) });

export const instructionTextSchema = z.object({ id: z.string().uuid(), instructions: z.string() });
export const instructionIdSchema = z.object({ id: z.string().uuid() });
