// The parts of a render spec (B9) and a colleague's own spec (ruling H115), apart from the renderer so the runner can
// tell a colleague the shape without loading a browser. One source: `localSpec` in `shoot.mjs` checks a spec with
// `localSchema`, and the toolkit line (`toolkitLine` in scripts/workforce/toolkit-args.ts) shows `localSpecShape()`,
// read from the same schema, so the words cannot drift from the check (W8 0e proof, P-4644).
import { z } from "zod";

export const imageSchema = z.object({
  url: z.string(),
  alt: z.string(),
  orientation: z.enum(["landscape", "portrait"]),
  w: z.number(),
  h: z.number(),
});
export const propertySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  city: z.string(),
  state: z.string(),
  market: z.string(),
  price: z.number(),
  currency: z.string(),
  beds: z.number(),
  baths: z.number(),
  interiorSqFt: z.number(),
  yearBuilt: z.number(),
  type: z.string(),
  place: z.string().default(""),
});
export const slideSchema = z.union([
  z.object({ kind: z.enum(["cover", "photo", "facts", "close"]), image: z.number().int() }),
  z.object({ kind: z.literal("place"), image: z.number().int(), text: z.string() }),
]);

// Role toolkits (ruling H115): a colleague's own spec, the property's facts and its photographs beside the spec file.
export const localSchema = z.object({
  property: propertySchema,
  images: z
    .array(
      imageSchema
        .omit({ url: true, w: true, h: true })
        .extend({ path: z.string(), w: z.number().optional(), h: z.number().optional() }),
    )
    .min(1)
    .max(12),
  slides: z.array(slideSchema).optional(),
});

/**
 * A schema in the words a colleague reads: an object as its keys (an optional one marked `?`), a list with its bounds,
 * a choice as its values. A kind of schema it does not know reads as "any value", never a guess.
 * @param {unknown} schema
 * @returns {string}
 */
export function shapeOf(schema) {
  if (schema instanceof z.ZodObject) {
    /** @type {unknown} */
    const shape = schema.shape;
    if (typeof shape !== "object" || shape === null) return "any value";
    const parts = Object.keys(shape).map((key) => {
      /** @type {unknown} */
      const field = Reflect.get(shape, key);
      const optional = field instanceof z.ZodOptional || field instanceof z.ZodDefault;
      return `"${key}"${optional ? "?" : ""}: ${shapeOf(field)}`;
    });
    return `{${parts.join(", ")}}`;
  }
  if (schema instanceof z.ZodOptional) return shapeOf(schema.unwrap());
  if (schema instanceof z.ZodDefault) return shapeOf(schema.removeDefault());
  if (schema instanceof z.ZodArray) {
    const least = schema._def.minLength?.value;
    const most = schema._def.maxLength?.value;
    const bounds =
      least !== undefined && most !== undefined
        ? ` (${String(least)} to ${String(most)})`
        : least !== undefined
          ? ` (at least ${String(least)})`
          : most !== undefined
            ? ` (at most ${String(most)})`
            : "";
    return `[${shapeOf(schema.element)}]${bounds}`;
  }
  if (schema instanceof z.ZodUnion) {
    /** @type {unknown} */
    const options = schema.options;
    return Array.isArray(options)
      ? options.map((option) => shapeOf(option)).join(" or ")
      : "any value";
  }
  if (schema instanceof z.ZodEnum) {
    /** @type {unknown} */
    const values = schema.options;
    return Array.isArray(values)
      ? values.map((value) => JSON.stringify(value)).join(" | ")
      : "any value";
  }
  if (schema instanceof z.ZodLiteral) return JSON.stringify(schema.value);
  if (schema instanceof z.ZodString) return "text";
  if (schema instanceof z.ZodNumber) return schema.isInt ? "whole number" : "number";
  return "any value";
}

/**
 * The shape of a colleague's spec file, read from `localSchema`.
 * @returns {string}
 */
export function localSpecShape() {
  return shapeOf(localSchema);
}
