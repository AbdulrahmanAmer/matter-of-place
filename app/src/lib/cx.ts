/** Joins class names, skipping falsy values. */
export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

const x: number = "a";
