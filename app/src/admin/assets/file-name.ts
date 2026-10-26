/** The name of a file for a person to read: the last part of its storage key or Drive path. */
export function fileName(key: string): string {
  return (
    key
      .split("/")
      .filter((part) => part !== "")
      .at(-1) ?? key
  );
}
