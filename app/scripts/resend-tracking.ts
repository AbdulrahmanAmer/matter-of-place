// B11 step 2: click tracking on and open tracking off for the domain Place Notes sends from (docs/runbooks/newsletter.md).
// From the app folder: `bun run scripts/resend-tracking.ts` sets the two switches and prints them; with `--check` it only
// reads them. `RESEND_API_KEY` comes from the shell, else from the git-ignored root `.env`, and is never printed. This is
// an operator's command, so it counts as a live call (`EMAIL_LIVE`); `EMAIL_DRY_RUN=1` still stops it. Exit 1 on any refusal.
import { getDomainTracking, setDomainTracking } from "../src/server/channels/resend.ts";
import { readResendKey } from "./resend-domain.ts";

const state = (on: boolean): string => (on ? "on" : "off");

/** Runs the command and answers the exit code. */
export async function run(args: readonly string[]): Promise<number> {
  const key = readResendKey();
  if (key === undefined) {
    console.error("BLOCKED: no RESEND_API_KEY");
    return 1;
  }
  process.env["RESEND_API_KEY"] = key;
  process.env["EMAIL_LIVE"] ??= "1";
  try {
    const tracking = args.includes("--check")
      ? await getDomainTracking()
      : await setDomainTracking({ click: true, open: false });
    if (tracking === null) {
      console.error("no call made: EMAIL_DRY_RUN is set");
      return 1;
    }
    console.log(`click_tracking ${state(tracking.click)} open_tracking ${state(tracking.open)}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "resend_tracking_failed");
    return 1;
  }
}

if (import.meta.main) process.exitCode = await run(process.argv.slice(2));
