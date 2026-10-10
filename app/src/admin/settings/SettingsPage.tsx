import { useState } from "react";
import type { SettingsAnswer } from "../../domain/admin-settings";
import { AdminApiError } from "../ui/admin-fetch";
import { AdminPending } from "../ui/AdminPending";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useToast } from "../ui/use-toast";
import { IdentitySection } from "./IdentitySection";
import { InvoicingSection } from "./InvoicingSection";
import { NotificationsSection } from "./NotificationsSection";
import { ReadinessBanner } from "./ReadinessBanner";
import {
  useSaveComingSoon,
  useSaveInvoice,
  useSaveNotifications,
  useSaveSite,
  useSettings,
} from "./settings-queries";
import { SiteSection } from "./SiteSection";

const failure = (error: unknown) =>
  error instanceof Error ? error.message : "This change could not be saved.";

/** The sections of screen 24 once the settings have loaded; each form starts from the stored value. */
function Sections({ settings }: { settings: SettingsAnswer }) {
  const toast = useToast();
  const saveSite = useSaveSite();
  const saveInvoice = useSaveInvoice();
  const saveComingSoon = useSaveComingSoon();
  const saveNotifications = useSaveNotifications();
  const [confirming, setConfirming] = useState<boolean | null>(null);
  const done = (message: string) => ({
    onSuccess: () => {
      toast({ message });
    },
    onError: (error: unknown) => {
      toast({ message: failure(error), tone: "danger" });
    },
  });
  return (
    <>
      <ReadinessBanner readiness={settings.readiness} />
      <section aria-labelledby="settings-identity">
        <h2 id="settings-identity">Identity</h2>
        <IdentitySection
          site={settings.site}
          readiness={settings.readiness}
          pending={saveSite.isPending}
          onSave={(site) => {
            saveSite.mutate(site, done("Identity saved."));
          }}
        />
      </section>
      <section aria-labelledby="settings-invoicing">
        <h2 id="settings-invoicing">Invoicing</h2>
        <InvoicingSection
          invoice={settings.invoice}
          pending={saveInvoice.isPending}
          onSave={(invoice) => {
            saveInvoice.mutate(invoice, done("Invoicing saved."));
          }}
        />
      </section>
      <section aria-labelledby="settings-site">
        <h2 id="settings-site">Site</h2>
        <SiteSection
          comingSoon={settings.coming_soon_global}
          pending={saveComingSoon.isPending}
          onChange={setConfirming}
        />
      </section>
      <section aria-labelledby="settings-notifications">
        <h2 id="settings-notifications">Notifications</h2>
        <NotificationsSection
          notifications={settings.notifications}
          pending={saveNotifications.isPending}
          onSave={(notifications) => {
            saveNotifications.mutate(notifications, done("Recipients saved."));
          }}
        />
      </section>
      <ConfirmDialog
        open={confirming !== null}
        title={confirming === true ? "Show the coming-soon page" : "Open the site"}
        confirmLabel={confirming === true ? "Show coming soon" : "Open the site"}
        danger={confirming === true}
        pending={saveComingSoon.isPending}
        onConfirm={() => {
          if (confirming === null) return;
          saveComingSoon.mutate(confirming, {
            ...done(confirming ? "The site shows coming soon." : "The site is open."),
            onSettled: () => {
              setConfirming(null);
            },
          });
        }}
        onCancel={() => {
          setConfirming(null);
        }}
      >
        <p>
          {confirming === true
            ? "Every public page will show the coming-soon signup."
            : "Published properties and stories will be public."}
        </p>
      </ConfirmDialog>
    </>
  );
}

/** Screen 24: identity, invoicing, the coming-soon switch and alert recipients, with what launch still needs. */
export function SettingsPage() {
  const settings = useSettings();
  const error = settings.error;
  return (
    <>
      <h1>Settings</h1>
      {error !== null ? (
        <p role="alert">
          {error.message}
          {error instanceof AdminApiError && error.requestId !== undefined
            ? ` Request ${error.requestId}.`
            : null}
        </p>
      ) : settings.data === undefined ? (
        <AdminPending />
      ) : (
        <Sections settings={settings.data} />
      )}
    </>
  );
}
