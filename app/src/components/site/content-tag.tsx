import { t } from "../../lib/strings";

/** Small label over photography marking content as illustrative. */
export function ContentTag({ label = t.common.illustrative }: { label?: string }) {
  return <span className="content-tag">{label}</span>;
}
