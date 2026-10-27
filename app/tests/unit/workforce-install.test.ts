import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// W8 item 3: the scheduled tasks scripts/workforce/install.ps1 registers. One file registers them all (P-3461:
// Priority 5, or a busy laptop starves them), and "MOP Captions" is the only way the caption runner is scheduled.
const script = readFileSync(new URL("../../scripts/workforce/install.ps1", import.meta.url), "utf8")
  .replace(/\s*`\r?\n\s*/g, " ")
  .split(/\r?\n/);

const registrations = script.flatMap((line) => {
  const found = /Register-ScheduledTask -TaskName "([^"]+)".*-Settings (\$\w+)/.exec(line);
  return found?.[1] !== undefined && found[2] !== undefined
    ? [{ name: found[1], settings: found[2], line }]
    : [];
});

const lineOf = (variable: string, command: string): string =>
  script.find((line) => line.startsWith(`${variable} = ${command}`)) ?? "";

describe("scripts/workforce/install.ps1", () => {
  it("registers every MOP task at Priority 5 and never two at once", () => {
    expect(registrations.map((entry) => entry.name)).toEqual([
      "MOP Workforce",
      "MOP Matter Live",
      "MOP Usage",
      "MOP Audit",
      "MOP Review",
      "MOP Captions",
      "MOP Meeting",
      "MOP Sweep",
    ]);
    for (const entry of registrations) {
      const settings = lineOf(entry.settings, "New-ScheduledTaskSettingsSet");
      expect(settings, `${entry.name} settings`).toContain("-Priority 5");
      expect(settings, `${entry.name} settings`).toContain("-MultipleInstances IgnoreNew");
    }
  });

  it("registers MOP Captions to run the captions runner every ten minutes, hidden, with its own log", () => {
    const task = registrations.find((entry) => entry.name === "MOP Captions");
    expect(task?.line).toContain("-Action $captionsAction -Trigger $captionsTrigger");
    expect(lineOf("$captionsAction", "New-ScheduledTaskAction")).toContain(
      '-Execute "wscript.exe" -Argument ("`"" + $vbs + "`" `"" + $app + "`" scripts\\captions-runner.ts captions")',
    );
    const trigger = lineOf("$captionsTrigger", "New-ScheduledTaskTrigger");
    expect(trigger).toContain("-RepetitionInterval (New-TimeSpan -Minutes 10)");
  });

  it("registers MOP Sweep every five minutes under a limit shorter than its interval (2026-10-27)", () => {
    expect(lineOf("$sweepAction", "New-ScheduledTaskAction")).toContain(
      'scripts\\workforce\\sweep.ts sweep")',
    );
    expect(lineOf("$sweepTrigger", "New-ScheduledTaskTrigger")).toContain(
      "-RepetitionInterval (New-TimeSpan -Minutes 5)",
    );
    expect(lineOf("$sweepSettings", "New-ScheduledTaskSettingsSet")).toContain(
      "-ExecutionTimeLimit (New-TimeSpan -Minutes 4)",
    );
  });

  it("takes off the old MatterOfPlace Captions task before it registers MOP Captions (W8 item 3 review)", () => {
    const removed = script.findIndex((line) =>
      line.startsWith('Unregister-ScheduledTask -TaskName "MatterOfPlace Captions"'),
    );
    const registered = script.findIndex((line) =>
      line.startsWith('Register-ScheduledTask -TaskName "MOP Captions"'),
    );
    expect(removed).toBeGreaterThan(-1);
    expect(removed).toBeLessThan(registered);
  });
});
