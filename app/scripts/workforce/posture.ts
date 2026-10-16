// W8 0d: how Matter lets a held message be answered, as a closed choice. Matter reads the outside text itself, so its
// own words never reach a colleague (they could carry the attempt past the fence): it names one of these postures, and
// the owner's run reads only the runner's fixed words for it. A posture never widens the source's criteria.

/** The four answers Matter may allow; anything else leaves the decision with a person. */
export const POSTURES = ["answer", "decline_kindly", "ask_one_question", "point_to_form"] as const;

export type Posture = (typeof POSTURES)[number];

/** What a `how` outside the four reads as: the schema keeps it, and it is never an allowance (H114). */
export const HOW_OFF_LIST = "off_list";

/** The runner's own words for each posture, the only form in which Matter's "how" reaches the owner. */
export const postureWords: Readonly<Record<Posture, string>> = {
  answer: "answer what they asked from our public facts only",
  decline_kindly: "decline kindly, and say we cannot do what they ask",
  ask_one_question: "ask the one question that would let us help",
  point_to_form: "point them to the form on our site that fits what they want",
};

/** Matter's held prompt names the four, in these words. */
export function postureChoices(): string {
  return POSTURES.map((posture) => `"${posture}" (${postureWords[posture]})`).join(", ");
}

/**
 * The posture an allowance carries: none given means `answer` (an allowance from before W8 0d's second half), one of
 * the four is itself, and anything else is null, so the allowance is not made.
 */
export function postureOf(how: Posture | typeof HOW_OFF_LIST | undefined): Posture | null {
  if (how === undefined) return "answer";
  return how === HOW_OFF_LIST ? null : how;
}

/** Said in every prompt about a held message (the explanation, Matter's read, the allowance), in fixed words. */
export const NOTHING_INSIDE =
  "No reply may say anything about our systems, staff, keys or other customers.";

/** Said in the owner's thread when Matter allowed an answer in a posture outside the four. */
export const HOW_REFUSED =
  "Matter allowed an answer but named no posture the runner knows, so nothing is proposed: the held message stays with a person.";
