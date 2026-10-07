import type { DecisionAnswer } from "../../domain/admin-submissions";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { EmailPreview } from "./EmailPreview";
import { useDecision, useEmailPreview } from "./requests-queries";

/** Accept the request; the sender gets the acceptance letter the preview shows, and the invoice follows from screen 5. */
export function AcceptDialog({
  id,
  open,
  onClose,
  onDecided,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  onDecided: (answer: DecisionAnswer) => void;
}) {
  const preview = useEmailPreview(id);
  const accept = useDecision(id, "accept");
  return (
    <ConfirmDialog
      open={open}
      title="Accept this request"
      confirmLabel="Accept"
      pending={accept.isPending}
      onConfirm={() => {
        accept.mutate({}, { onSuccess: onDecided });
      }}
      onCancel={onClose}
    >
      <p>The sender is told the property has been selected and that an invoice will follow.</p>
      <EmailPreview
        letter={preview.data}
        pending={preview.isPending}
        ready
        error={preview.error?.message ?? null}
        onPreview={() => {
          preview.mutate({ template: "accepted" });
        }}
      />
      {accept.error === null ? null : <p role="alert">{accept.error.message}</p>}
    </ConfirmDialog>
  );
}
