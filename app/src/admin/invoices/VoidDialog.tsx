import { RoleGate } from "../ui/RoleGate";
import { ReasonDialog } from "./ReasonDialog";

/** Void a due invoice issued in error (admin only). The number is never reused and the PDF stays on file. */
export function VoidDialog({ onVoid }: { onVoid: (reason: string) => Promise<unknown> }) {
  return (
    <RoleGate action="payments.void">
      <ReasonDialog
        trigger="Void"
        title="Void this invoice"
        confirmLabel="Void invoice"
        intro="Use this for an invoice issued in error. Its number is never reused and its PDF stays on file."
        danger
        onSubmit={onVoid}
      />
    </RoleGate>
  );
}
