import { useState } from "react";
import { marketTimezone, toUtc } from "../../domain/market-time";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { useSubmit } from "./use-submit";

const ZONE = marketTimezone(null);
const FUTURE = "The payment date cannot be in the future.";

/**
 * The date is a day, read in Eastern time (an invoice has no market of its own). A day that has not begun is
 * refused here, as the server refuses it; the day of today is sent as now, never as a later hour of it.
 */
function paidAtOf(day: string, now: number): { paidAt: string } | { future: true } {
  if (Date.parse(toUtc(`${day}T00:00`, ZONE)) > now) return { future: true };
  const noon = Date.parse(toUtc(`${day}T12:00`, ZONE));
  return { paidAt: new Date(Math.min(noon, now)).toISOString() };
}

function MarkPaidForm({
  onSubmit,
  onClose,
}: {
  onSubmit: (input: { paidAt: string; method: string; reference?: string }) => Promise<unknown>;
  onClose: () => void;
}) {
  const [day, setDay] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const { pending, error: failure, submit } = useSubmit(onSubmit, onClose);
  // Read when the dialog opens, not on every key: the form is built fresh each time it opens.
  const [now] = useState(() => Date.now());
  const when = day === "" ? null : paidAtOf(day, now);
  const error = when !== null && "future" in when ? FUTURE : failure;

  const send = () => {
    if (when === null || "future" in when) return;
    const note = reference.trim();
    void submit({
      paidAt: when.paidAt,
      method: method.trim(),
      ...(note === "" ? {} : { reference: note }),
    });
  };

  return (
    <form
      className="admin-dialog__panel"
      data-print="hide"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <div className="admin-dialog__head">
        <h2>Mark this invoice paid</h2>
      </div>
      <div className="admin-dialog__body">
        <Field label="Date received" hint="Eastern time." {...(error === null ? {} : { error })}>
          {(control) => (
            <input
              {...control}
              type="date"
              required
              value={day}
              onChange={(event) => {
                setDay(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Method" hint="How it was paid, for example bank transfer.">
          {(control) => (
            <input
              {...control}
              type="text"
              required
              maxLength={60}
              value={method}
              onChange={(event) => {
                setMethod(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Reference" hint="Optional. A transfer or confirmation number.">
          {(control) => (
            <input
              {...control}
              type="text"
              maxLength={200}
              value={reference}
              onChange={(event) => {
                setReference(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <div className="admin-actions">
        <button
          type="submit"
          className="admin-button"
          disabled={pending || when === null || "future" in when || method.trim() === ""}
        >
          Mark paid
        </button>
        <button type="button" className="admin-button admin-button--quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Records a payment on a due invoice: the day, the method and an optional reference. */
export function MarkPaidDialog({
  onMarkPaid,
}: {
  onMarkPaid: (input: { paidAt: string; method: string; reference?: string }) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        className="admin-button"
        data-print="hide"
        onClick={() => {
          setOpen(true);
        }}
      >
        Mark paid
      </button>
      <Dialog open={open} onClose={close} label="Mark this invoice paid">
        <MarkPaidForm onSubmit={onMarkPaid} onClose={close} />
      </Dialog>
    </>
  );
}
