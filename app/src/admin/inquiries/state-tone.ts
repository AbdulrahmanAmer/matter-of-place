import type { InquiryState } from "../../domain/admin-inquiries";
import type { Tone } from "../ui/StatusPill";

/** The tone of each state's pill, on the list and in the drawer. */
export const stateTone: Record<InquiryState, Tone> = {
  new: "info",
  in_progress: "warning",
  forwarded: "ok",
  closed: "neutral",
};
