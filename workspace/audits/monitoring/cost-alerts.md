# Cost and usage alerts

The vendors send their own notifications at thresholds they choose (assumed 80 and 100 percent).
They are a second net: our own gauges in `tools/limits.json` warn at 50, 70 and 90 percent.
The owner turns each one on, once, in the vendor's dashboard, and signs below. The audit robot
never changes a vendor setting.

| Vendor | Where | What to switch on | Done |
|---|---|---|---|
| Supabase | Organization settings, Billing, usage | Spend and usage emails to the admin mailbox | |
| Cloudflare | Notifications | Workers usage alert on the account, to the admin mailbox | |
| GitHub | Settings, Billing and plans | Actions budget email for the account | |
| Resend | Dashboard, Settings | Usage email to the admin mailbox | |
| Sentry | Settings, Subscription | Quota email to the admin mailbox | |
| Uptime monitor | Alert contacts | The admin mailbox, confirmed from the mail it sends | |

Fill the Done column with the date each alert was switched on, then the line below.

Signed: <initials> <date>
