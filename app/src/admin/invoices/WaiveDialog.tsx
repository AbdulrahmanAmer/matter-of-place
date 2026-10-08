import { ReasonDialog } from "./ReasonDialog";

/** Waive a due invoice: it is no longer owed. `onWaive` runs with the reason. */
export function WaiveDialog({ onWaive }: { onWaive: (reason: string) => Promise<unknown> }) {
  return (
    <ReasonDialog
      trigger="Waive"
      title="Waive this invoice"
      confirmLabel="Waive"
      intro="The invoice is no longer owed. The request can then be activated."
      onSubmit={onWaive}
    />
  );
}
