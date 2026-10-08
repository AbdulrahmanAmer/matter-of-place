import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AdminMeContext } from "./admin-me";
import { ToastProvider } from "./Toast";

/** The providers a console component needs, with a media_ops actor who holds exactly `actions`. */
export function AdminProviders({ actions, children }: { actions: string[]; children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AdminMeContext
          value={{
            actor: { id: "u1" },
            kind: "human",
            roles: ["media_ops"],
            scopes: [],
            actions,
            environment: "production",
          }}
        >
          {children}
        </AdminMeContext>
      </ToastProvider>
    </QueryClientProvider>
  );
}
