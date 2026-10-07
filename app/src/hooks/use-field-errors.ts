import { useCallback, useId, useState, type SyntheticEvent } from "react";
import { t } from "../lib/strings";

type Errors = Partial<Record<string, string>>;

/**
 * Field errors of one form, found with the browser's own constraint checks when the form is sent (give the form
 * `noValidate`). `field(name)` is for `Field`, `control(name)` for its input: an invalid control carries
 * `aria-invalid` and points `aria-describedby` at the visible error text. Focus moves to the first invalid control.
 */
export function useFieldErrors() {
  const prefix = useId();
  const [errors, setErrors] = useState<Errors>({});
  const errorId = (name: string) => `${prefix}-${name}-error`;

  const validate = useCallback((form: HTMLFormElement) => {
    const found: Errors = {};
    let first: HTMLElement | undefined;
    for (const control of form.elements) {
      if (
        (control instanceof HTMLInputElement ||
          control instanceof HTMLTextAreaElement ||
          control instanceof HTMLSelectElement) &&
        control.name !== "" &&
        !control.validity.valid
      ) {
        found[control.name] = control.validity.valueMissing
          ? t.forms.fieldRequired
          : t.forms.fieldInvalid;
        first ??= control;
      }
    }
    setErrors(found);
    first?.focus();
    return first === undefined;
  }, []);

  /** Clears the error of the control the visitor is typing in. */
  const clear = useCallback((event: SyntheticEvent<HTMLFormElement>) => {
    const { target } = event;
    if (target instanceof HTMLElement && "name" in target && typeof target.name === "string") {
      const { name } = target;
      setErrors((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => key !== name)),
      );
    }
  }, []);

  const clearAll = useCallback(() => setErrors({}), []);

  return {
    validate,
    clear,
    clearAll,
    field: (name: string) => ({ error: errors[name], errorId: errorId(name) }),
    control: (name: string) =>
      errors[name] === undefined ? {} : { "aria-invalid": true, "aria-describedby": errorId(name) },
  };
}
