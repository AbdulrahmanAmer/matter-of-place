/** A Property Exposure product, shown on the home page and the Exposure page. */
export type Offering = {
  id: "feature" | "reach" | "campaign" | "five-features";
  name: string;
  /** Display price, already formatted ("$295"). */
  price: string;
  /** One-line purpose. */
  line: string;
  /** Optional qualifier under the price ("$250 per property"). */
  note?: string;
  items: string[];
  cta: string;
  recommended?: boolean;
};

/** Programmatic media terms, billed separately from editorial products. */
export type ProgrammaticTerms = {
  minimum: string;
  managementFee: string;
  minimumFee: string;
  formats: string[];
};
