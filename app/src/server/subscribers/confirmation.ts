/**
 * The sealed form of a confirmation token, which the `subscriber.created` event carries to the mail step (G12), or
 * null while no confirmation mail is sent; it emits nothing (G20). The raw token never leaves the request.
 */
// STUB(B5 step 7): sealToken replaces this body
export function requestConfirmation(_token: string): Promise<string | null> {
  return Promise.resolve(null);
}
