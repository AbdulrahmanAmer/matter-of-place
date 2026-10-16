/**
 * A signed-in person whose address holds no request with us (W6 item 7, ruling H119 (3)): a calm page and no data.
 */
export function AccountNotFound({
  onSignOut,
  signingOut,
}: {
  onSignOut: () => void;
  signingOut: boolean;
}) {
  return (
    <div className="copy-page">
      <h2>We could not find your account</h2>
      <p>
        This address holds no request with us. If you wrote to us from another address, sign out and
        use that one.
      </p>
      <div className="form-actions">
        <button type="button" className="button" onClick={onSignOut} disabled={signingOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
