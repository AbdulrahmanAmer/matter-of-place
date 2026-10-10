/** What a page shows after 300 ms of loading its data: quiet blocks where the page will be (H1-23). */
export function RoutePending() {
  return (
    <main
      className="route-pending"
      data-pending
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="route-pending-block route-pending-eyebrow" />
      <div className="route-pending-block route-pending-title" />
      <div className="route-pending-block route-pending-line" />
      <div className="route-pending-block route-pending-line" />
    </main>
  );
}
