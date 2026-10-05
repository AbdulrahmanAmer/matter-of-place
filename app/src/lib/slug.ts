/**
 * The address segment of a label: lower case, accents folded, apostrophes dropped, every other run of
 * characters that are not letters or digits one hyphen. Deterministic, so a facet label and the archive
 * address that names it always agree.
 */
export function slugify(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
