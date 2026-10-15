import { useState, type InputHTMLAttributes } from "react";
import { EmailSuggestion } from "./email-suggestion";

/** An email field of a form read through `FormData`, with the typo suggestion under it (W9 item 1). */
export function EmailInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value">) {
  const [value, setValue] = useState("");
  return (
    <>
      <input
        {...props}
        type="email"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      <EmailSuggestion value={value} onUse={setValue} />
    </>
  );
}
