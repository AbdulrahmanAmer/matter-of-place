import type { ReactElement } from "react";
import * as acceptedFile from "./accepted.tsx";
import * as adminNotifyFile from "./admin-notify.tsx";
import * as awaitingAssetsFile from "./awaiting-assets.tsx";
import * as campaignReportFile from "./campaign-report.tsx";
import * as declinedFile from "./declined.tsx";
import * as inquiryAckFile from "./inquiry-ack.tsx";
import * as inquiryForwardFile from "./inquiry-forward.tsx";
import * as interestConfirmFile from "./interest-confirm.tsx";
import type { EmailDefinition, EmailProps } from "./layout.tsx";
import * as invoiceFile from "./invoice.tsx";
import * as marketOpenFile from "./market-open.tsx";
import * as newsletterConfirmFile from "./newsletter-confirm.tsx";
import * as receivedFile from "./received.tsx";
import * as repermissionFile from "./repermission.tsx";
import * as standaloneFile from "./standalone.tsx";
import * as subjectAckFile from "./subject-ack.tsx";

/** What every template file exports: its seed and the component that draws a row of that key. */
export interface EmailTemplateFile {
  definition: EmailDefinition;
  Email: (props: EmailProps) => ReactElement;
}

/** One entry per template file. A slice that adds a template file appends it here, with its seeded row (G46). */
export const definitions: readonly EmailTemplateFile[] = [
  receivedFile,
  declinedFile,
  acceptedFile,
  awaitingAssetsFile,
  invoiceFile,
  inquiryAckFile,
  inquiryForwardFile,
  interestConfirmFile,
  newsletterConfirmFile,
  adminNotifyFile,
  standaloneFile,
  repermissionFile,
  subjectAckFile,
  marketOpenFile,
  campaignReportFile,
];

/** A definition as the row it seeds: the shape `renderTemplate` takes. */
export function definitionRow({ key, subject, preheader, blocks }: EmailDefinition) {
  return { key, subject, preheader, body: blocks };
}
