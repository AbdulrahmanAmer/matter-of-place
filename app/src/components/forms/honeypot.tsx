import type { Ref } from "react";
import { honeypotFieldName } from "../../domain/contracts";

/**
 * The bot trap of GD-05: one text field a person never sees or reaches. A bot that fills it gets an ordinary
 * receipt and nothing is stored.
 */
export function Honeypot({ ref }: { ref?: Ref<HTMLInputElement> }) {
  return (
    <div className="hp-field">
      <label>
        Leave this field empty
        <input
          ref={ref}
          type="text"
          name={honeypotFieldName}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />
      </label>
    </div>
  );
}
