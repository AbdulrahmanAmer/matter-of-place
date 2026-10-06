function show(value: unknown): string {
  if (value === undefined || value === null) return "empty";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** What changed between a before and an after (an audit row, a revision): only the keys whose value differs. */
export function DiffView({
  before,
  after,
}: {
  before: Readonly<Record<string, unknown>> | null;
  after: Readonly<Record<string, unknown>> | null;
}) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter(
    (key) => show(before?.[key]) !== show(after?.[key]),
  );
  if (keys.length === 0) return <p>No changes.</p>;
  return (
    <table className="admin-diff">
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Before</th>
          <th scope="col">After</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => (
          <tr key={key}>
            <th scope="row">{key}</th>
            <td className="admin-diff__before">{show(before?.[key])}</td>
            <td className="admin-diff__after">{show(after?.[key])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
