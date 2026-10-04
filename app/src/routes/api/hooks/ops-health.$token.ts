import { createFileRoute } from "@tanstack/react-router";
import { handleOpsHealth } from "../../../server/hooks/ops-health";
import { getDb } from "../../../server/lib/db";
import { env } from "../../../server/lib/env";

export const Route = createFileRoute("/api/hooks/ops-health/$token")({
  server: {
    handlers: {
      GET: ({ params }) => handleOpsHealth(getDb, params.token, env),
    },
  },
});
