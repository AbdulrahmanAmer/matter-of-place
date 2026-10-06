/** What an admin child route shows after 300 ms of loading: quiet blocks where the page will be. */
export function AdminPending() {
  return (
    <div className="admin-pending" role="status" aria-busy="true" aria-label="Loading">
      <div className="admin-skeleton" />
      <div className="admin-skeleton" />
      <div className="admin-skeleton" />
    </div>
  );
}
