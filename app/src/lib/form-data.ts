/** One text field of a submitted form; a missing field or a file reads as empty. */
export function formText(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}
