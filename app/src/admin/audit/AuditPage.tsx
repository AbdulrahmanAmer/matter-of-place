import { useState } from "react";
import { z } from "zod";
import { auditFilterNames, type AuditRow } from "../../domain/admin-audit";
import { AdminApiError } from "../ui/admin-fetch";
import { DiffView } from "../ui/DiffView";
import { Drawer } from "../ui/Drawer";
import { LocalTime } from "../ui/LocalTime";
import { useUrlFilters } from "../ui/use-url-filters";
import { AuditTable } from "./AuditTable";
import { useAuditLog } from "./audit-queries";

const fieldsSchema = z.record(z.string(), z.unknown());

/** An object compares field by field; any other stored value (a boolean key, a list) is one field named value. */
function fieldsOf(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || value === undefined) return null;
  return fieldsSchema.safeParse(value).data ?? { value };
}

/** One audit row: who changed what and when, and the fields whose value changed. */
function AuditDiff({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  return (
    <Drawer open onClose={onClose} title={row.action}>
      <dl>
        <dt>When</dt>
        <dd>
          <LocalTime value={row.at} />
        </dd>
        <dt>Actor</dt>
        <dd>
          {row.actor_id === null ? "System" : `${row.actor_id} (${row.actor_kind ?? "human"})`}
        </dd>
        <dt>Entity</dt>
        <dd>{row.entity_id === null ? row.entity : `${row.entity} ${row.entity_id}`}</dd>
        {row.request_id === null ? null : (
          <>
            <dt>Request</dt>
            <dd>{row.request_id}</dd>
          </>
        )}
        {row.note === null ? null : (
          <>
            <dt>Note</dt>
            <dd>{row.note}</dd>
          </>
        )}
      </dl>
      <DiffView before={fieldsOf(row.before)} after={fieldsOf(row.after)} />
    </Drawer>
  );
}

/** Screen 25: the audit log, newest first, narrowed by the address; a row opens what it changed. */
export function AuditPage() {
  const filters = useUrlFilters(auditFilterNames);
  const audit = useAuditLog(filters.values, filters.cursor);
  const [open, setOpen] = useState<AuditRow | null>(null);
  const failure = audit.error;
  const nextCursor = audit.data?.next_cursor ?? null;
  return (
    <>
      <h1>Audit log</h1>
      <AuditTable
        filters={{ values: filters.values, onChange: filters.setFilters }}
        rows={audit.data?.items ?? []}
        loading={audit.isPending}
        error={
          failure === null
            ? null
            : {
                message: failure.message,
                ...(failure instanceof AdminApiError && failure.requestId !== undefined
                  ? { requestId: failure.requestId }
                  : {}),
              }
        }
        onOpen={setOpen}
        pager={{
          hasPrevious: filters.hasPrevious,
          hasNext: nextCursor !== null,
          onPrevious: filters.goPrevious,
          onNext: () => {
            if (nextCursor !== null) filters.goNext(nextCursor);
          },
        }}
      />
      {open === null ? null : (
        <AuditDiff
          key={open.id}
          row={open}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </>
  );
}
