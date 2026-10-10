import { useReasons } from "./automation-queries";
import { ReasonsTable } from "./ReasonsTable";
import { RequestFailure } from "./RequestFailure";

/** Screen 19: the reasons an editor can give when a submission is declined, and the paragraph each one puts in the email. */
export function ReasonsPage() {
  const reasons = useReasons();
  if (reasons.isPending) return <p role="status">Loading reasons.</p>;
  if (reasons.isError) return <RequestFailure error={reasons.error} />;
  return (
    <>
      <h1>Decline reasons</h1>
      <p className="admin-recipes__intro">
        What an editor can choose when a request is declined. A change applies to the next decline,
        with no deploy.
      </p>
      <ReasonsTable items={reasons.data.items} />
    </>
  );
}
