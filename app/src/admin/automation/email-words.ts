import type { EmailTemplateKey } from "../../domain/email";

// Admin pass (operator, 2026-10-12: "high quality screens ... super great layout"): each email by the name a person
// uses for it, who receives it and the topic it is listed under, so the list never asks anyone to read `inquiry_ack`.

export const emailTopics = [
  "Requests",
  "Readers",
  "Clients and money",
  "The team and care",
] as const;
type EmailTopic = (typeof emailTopics)[number];

interface EmailWords {
  name: string;
  /** Finishes "Sent to ..." */
  to: string;
  topic: EmailTopic;
}

export const emailWords: Record<EmailTemplateKey, EmailWords> = {
  received: { name: "Request received", to: "the owner or agent who sent it", topic: "Requests" },
  awaiting_assets: {
    name: "Photographs needed",
    to: "the owner or agent, while we wait for material",
    topic: "Requests",
  },
  accepted: { name: "Request accepted", to: "the owner or agent", topic: "Requests" },
  declined: { name: "Request declined", to: "the owner or agent", topic: "Requests" },
  inquiry_ack: { name: "Inquiry received", to: "the person who wrote", topic: "Readers" },
  inquiry_forward: {
    name: "Inquiry passed on",
    to: "the listing agent of the property",
    topic: "Readers",
  },
  interest_confirm: {
    name: "Confirm market interest",
    to: "someone who asked to hear when a market opens",
    topic: "Readers",
  },
  market_open: { name: "A market opens", to: "everyone waiting for that market", topic: "Readers" },
  newsletter_confirm: {
    name: "Confirm Place Notes",
    to: "a new Place Notes reader",
    topic: "Readers",
  },
  newsletter_welcome: {
    name: "Welcome",
    to: "someone who has just confirmed, once",
    topic: "Readers",
  },
  repermission: {
    name: "Still want Place Notes?",
    to: "readers who have not opened in a long while",
    topic: "Readers",
  },
  invoice: { name: "Invoice", to: "the client being invoiced", topic: "Clients and money" },
  campaign_report: {
    name: "Weekly property report",
    to: "the client whose property is running",
    topic: "Clients and money",
  },
  admin_notify: { name: "Note to the team", to: "the team's inbox", topic: "The team and care" },
  standalone: {
    name: "One-off message",
    to: "whoever a flow names",
    topic: "The team and care",
  },
  subject_ack: {
    name: "Personal data request received",
    to: "the person asking about their data",
    topic: "The team and care",
  },
};
