import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AdminApiError } from "../ui/admin-fetch";
import { adminKeys, invalidateAfterWrite } from "../query";
import {
  activate,
  fetchPayment,
  fetchPayments,
  issueInvoice,
  markPaid,
  voidInvoice,
  waive,
  waiveWithoutInvoice,
} from "./payments-api";

/** The filters of screen 5 that live in the address, beside the cursor. */
export const invoiceFilterNames = ["status", "overdue"] as const;

export type InvoiceFilterName = (typeof invoiceFilterNames)[number];

export function usePayments(query: Readonly<Record<string, string>>) {
  return useQuery({
    queryKey: adminKeys.payments.list(query),
    queryFn: () => fetchPayments(query),
  });
}

export function usePayment(id: string) {
  return useQuery({
    queryKey: adminKeys.payments.detail(id),
    queryFn: () => fetchPayment(id),
  });
}

/** A write changes the invoice list, the dashboard counts, and the request: its timeline, its state and its detail. */
async function settle(queryClient: QueryClient, submissionId: string) {
  await Promise.all([
    invalidateAfterWrite(
      queryClient,
      adminKeys.payments.all(),
      adminKeys.submissions.timeline(submissionId),
    ),
    queryClient.invalidateQueries({ queryKey: adminKeys.submissions.detail(submissionId) }),
  ]);
}

function useSettled(submissionId: string) {
  const queryClient = useQueryClient();
  return () => settle(queryClient, submissionId);
}

export function useIssueInvoice(submissionId: string) {
  const onSettled = useSettled(submissionId);
  return useMutation({
    mutationFn: (input: { product: string; preferredMethod: string }) =>
      issueInvoice({ submissionId, ...input }),
    onSettled,
  });
}

export function useWaiveWithoutInvoice(submissionId: string) {
  const onSettled = useSettled(submissionId);
  return useMutation({
    mutationFn: (input: { product: string; reason: string }) =>
      waiveWithoutInvoice(submissionId, input),
    onSettled,
  });
}

export function useActivate(submissionId: string) {
  const onSettled = useSettled(submissionId);
  return useMutation({ mutationFn: () => activate(submissionId), onSettled });
}

export function useMarkPaid(id: string, submissionId: string) {
  const onSettled = useSettled(submissionId);
  return useMutation({
    mutationFn: (input: { paidAt: string; method: string; reference?: string }) =>
      markPaid(id, input),
    onSettled,
  });
}

export function useWaive(id: string, submissionId: string) {
  const onSettled = useSettled(submissionId);
  return useMutation({ mutationFn: (reason: string) => waive(id, reason), onSettled });
}

export function useVoid(id: string, submissionId: string) {
  const onSettled = useSettled(submissionId);
  return useMutation({ mutationFn: (reason: string) => voidInvoice(id, reason), onSettled });
}

const MISSING = /missing: (.+)\.$/;

/**
 * The settings an issue was refused for (invariant 7): the 409 `invoice_not_ready` names them in its message, as
 * dotted setting names. Empty for any other error. No route reads these settings before screen 24 exists.
 */
export function missingSettings(error: unknown): string[] {
  if (!(error instanceof AdminApiError) || error.code !== "invoice_not_ready") return [];
  return (MISSING.exec(error.message)?.[1] ?? "").split(", ").filter((name) => name !== "");
}
