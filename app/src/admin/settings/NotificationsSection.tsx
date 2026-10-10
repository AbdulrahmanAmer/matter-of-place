import { useState } from "react";
import { notificationsPutInput, type NotificationsInput } from "../../domain/admin-settings";
import { Field } from "../ui/Field";

/** Who hears admin alerts: one address per line. With none, alerts go to the public contact address. */
export function NotificationsSection({
  notifications,
  pending,
  onSave,
}: {
  notifications: NotificationsInput;
  pending: boolean;
  onSave: (notifications: NotificationsInput) => void;
}) {
  const [text, setText] = useState(notifications.recipients.join("\n"));
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="admin-fields"
      onSubmit={(event) => {
        event.preventDefault();
        const recipients = text
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "");
        const parsed = notificationsPutInput.safeParse({ recipients });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Check the addresses.");
          return;
        }
        setError(null);
        onSave(parsed.data);
      }}
    >
      <Field
        label="Alert recipients"
        hint="One email address per line, up to 20. Leave empty to use the contact email."
        {...(error === null ? {} : { error })}
      >
        {(control) => (
          <textarea
            {...control}
            rows={4}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        )}
      </Field>
      <button type="submit" className="admin-button" disabled={pending}>
        Save recipients
      </button>
    </form>
  );
}
