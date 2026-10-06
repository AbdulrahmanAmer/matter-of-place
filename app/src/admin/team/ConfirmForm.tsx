// Screen 1's confirm step (API-01): opening the mailed link only renders this button, so a mail scanner's
// GET spends nothing. The POST spends the token hash and sets the session.

interface ConfirmFormProps {
  tokenHash: string;
  type: "email" | "invite";
  next: string | undefined;
}

export function ConfirmForm({ tokenHash, type, next }: ConfirmFormProps) {
  return (
    <form method="post" action="/api/admin/auth/verify" className="admin-signin">
      <h1>Sign in</h1>
      <p>Continue to finish signing in on this device.</p>
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      {next === undefined ? null : <input type="hidden" name="next" value={next} />}
      <button type="submit">Continue to Matter of Place</button>
    </form>
  );
}
