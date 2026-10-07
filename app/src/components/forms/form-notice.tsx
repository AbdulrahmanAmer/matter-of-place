import type { ReactNode } from "react";
import { isLive } from "../../services";
import { t } from "../../lib/strings";

/** One line beneath a form while the API is not configured; renders nothing once it is. */
export function DeliveryNotice() {
  if (isLive) return null;
  return <p className="form-note">{t.forms.localNotice}</p>;
}

/** Inline error beneath a form's actions. */
export function FormError({ message, id }: { message: string | null; id?: string }) {
  if (!message) return null;
  return (
    <p className="form-error" role="alert" id={id}>
      {message}
    </p>
  );
}

/** Confirmation panel shown in place of a form after it is accepted. */
export function SentNotice({
  title = t.forms.thankYou,
  text,
  children,
}: {
  title?: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="sent-notice" role="status">
      <p className="eyebrow">A QUIET NOTE</p>
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}
