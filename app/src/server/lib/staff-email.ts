import type { Db } from "./db.ts";
import { AppError } from "./errors.ts";

/** The sign-in address of a staff user or agent, for the one mail an action sends to the person who asked for it. */
export async function staffEmail(db: Db, userId: string): Promise<string> {
  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error !== null) {
    throw new AppError(
      "unavailable",
      undefined,
      "The service is busy. Please try again in a moment.",
    );
  }
  const email = data.user.email;
  if (email === undefined || email === "") {
    throw new AppError("validation", undefined, "This account has no email address.");
  }
  return email;
}
