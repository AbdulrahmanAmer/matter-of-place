import { honeypotFieldName } from "../domain/contracts";

/** Adds what the hidden bot-trap field holds to a write, never validated here, so the Worker sees it (GD-05). */
export function withHoneypot<T extends object>(input: T, trap: string): T {
  return { ...input, [honeypotFieldName]: trap };
}

/** One text field of a submitted form; a missing field or a file reads as empty. */
export function formText(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}
