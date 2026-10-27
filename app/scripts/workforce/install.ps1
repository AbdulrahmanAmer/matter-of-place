# W1: installs the workforce on this laptop (PowerShell 5.1: no ternary, no ??).
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\workforce\install.ps1
# 1. The scheduled task "MOP Workforce": one hidden pass every minute, never two at once.
# 2. The desktop shortcut "Matter of Place Office": the office as its own window (Chrome app mode).
# Remove both with: Unregister-ScheduledTask -TaskName "MOP Workforce" -Confirm:$false; and delete the shortcut.
$ErrorActionPreference = "Stop"
$app = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$home2 = Join-Path $env:USERPROFILE ".mop-workforce"
New-Item -ItemType Directory -Force -Path $home2 | Out-Null
# Gap audit item 6: the one folder the daemon may move to origin/main by itself (scripts/workforce/follow.ts).
Set-Content -Path (Join-Path $home2 "runner-app") -Value $app -NoNewline

$vbs = Join-Path $PSScriptRoot "hidden-run.vbs"
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument ("`"" + $vbs + "`" `"" + $app + "`"")
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
# No time limit (2026-10-27, P-4660): a limit ends only the hidden launcher, never the pass under it, so a second pass
# started beside one still answering. MOP Sweep ends a pass past its ceiling (ruling H150), with everything it started.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -Priority 5 `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
Register-ScheduledTask -TaskName "MOP Workforce" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Matter of Place AI colleagues: one pass a minute (scripts/workforce/daemon.ts)." -Force | Out-Null
Write-Output "task: MOP Workforce registered (every minute, hidden)"

# 2b. W5: the scheduled task "MOP Matter Live": Matter's live session supervisor (scripts/matter/live.ts). It runs
# without end; the task checks every five minutes and starts it again if it stopped (never two at once).
$liveAction = New-ScheduledTaskAction -Execute "wscript.exe" `
  -Argument ("`"" + $vbs + "`" `"" + $app + "`" scripts\matter\live.ts live")
$liveTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$liveSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -Priority 5 `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
Register-ScheduledTask -TaskName "MOP Matter Live" -Action $liveAction -Trigger $liveTrigger -Settings $liveSettings `
  -Description "Matter of Place: Matter's live session (scripts/matter/live.ts), kept running." -Force | Out-Null
Write-Output "task: MOP Matter Live registered (checked every five minutes, hidden)"

# 3. The scheduled task "MOP Usage": the dashboard's vendor gauges measured once a day (scripts/usage-push.ts).
$usageAction = New-ScheduledTaskAction -Execute "wscript.exe" `
  -Argument ("`"" + $vbs + "`" `"" + $app + "`" scripts\usage-push.ts usage")
$usageTrigger = New-ScheduledTaskTrigger -Daily -At "06:00"
Register-ScheduledTask -TaskName "MOP Usage" -Action $usageAction -Trigger $usageTrigger -Settings $settings `
  -Description "Matter of Place: Workers requests, Sentry errors and Actions minutes for the dashboard." -Force | Out-Null
Start-ScheduledTask -TaskName "MOP Usage"
Write-Output "task: MOP Usage registered (daily at 06:00, run once now)"

# 4. The scheduled task "MOP Audit": the Saturday audit routine at 09:00 local time (B14, gap audit item 25).
$auditAction = New-ScheduledTaskAction -Execute "wscript.exe" `
  -Argument ("`"" + $vbs + "`" `"" + $app + "`" scripts\audit-routine.ts audit")
$auditTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At "09:00"
$auditSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -Priority 5 `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
Register-ScheduledTask -TaskName "MOP Audit" -Action $auditAction -Trigger $auditTrigger -Settings $auditSettings `
  -Description "Matter of Place: the Saturday audit routine (workspace/audits/ROUTINE-PROMPT.md)." -Force | Out-Null
Write-Output "task: MOP Audit registered (Saturday 09:00 local)"

# 5. The scheduled task "MOP Review": the staff's weekly review at 10:00 Sunday local (W2 step 6, scripts/workforce/review.ts).
$reviewAction = New-ScheduledTaskAction -Execute "wscript.exe" `
  -Argument ("`"" + $vbs + "`" `"" + $app + "`" scripts\workforce\review.ts review")
$reviewTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "10:00"
Register-ScheduledTask -TaskName "MOP Review" -Action $reviewAction -Trigger $reviewTrigger -Settings $auditSettings `
  -Description "Matter of Place: the AI staff's weekly review (lessons, instructions, the week's numbers)." -Force | Out-Null
Write-Output "task: MOP Review registered (Sunday 10:00 local)"

# 5b. W8 item 3: the scheduled task "MOP Captions": the captions runner (scripts/captions-runner.ts, ruling H34) every
#    ten minutes, so a published property's captions are written without anyone running a command. It stops when no job
#    is due; the health check captions_waiting names a job waiting more than an hour. The task the removed
#    install-captions-task.ps1 registered is taken off first, so a reinstall never leaves two caption tasks running.
Unregister-ScheduledTask -TaskName "MatterOfPlace Captions" -Confirm:$false -ErrorAction SilentlyContinue
$captionsAction = New-ScheduledTaskAction -Execute "wscript.exe" `
  -Argument ("`"" + $vbs + "`" `"" + $app + "`" scripts\captions-runner.ts captions")
$captionsTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "MOP Captions" -Action $captionsAction -Trigger $captionsTrigger -Settings $auditSettings `
  -Description "Matter of Place: captions and alt texts of published properties, through the operator's Claude account." -Force | Out-Null
Write-Output "task: MOP Captions registered (every ten minutes, hidden)"

# 6. The scheduled task "MOP Meeting": the team's daily meeting at 17:45 local (W2 step 7, scripts/workforce/meeting.ts);
#    the decisions land by 18:00 Cairo time, and Windows follows Egypt's clock changes.
$meetingAction = New-ScheduledTaskAction -Execute "wscript.exe" `
  -Argument ("`"" + $vbs + "`" `"" + $app + "`" scripts\workforce\meeting.ts meeting")
$meetingTrigger = New-ScheduledTaskTrigger -Daily -At "17:45"
Register-ScheduledTask -TaskName "MOP Meeting" -Action $meetingAction -Trigger $meetingTrigger -Settings $auditSettings `
  -Description "Matter of Place: the AI team's daily meeting (scorecard, three lines each, Matter's decisions)." -Force | Out-Null
Write-Output "task: MOP Meeting registered (daily 17:45 local)"

# 7. The scheduled task "MOP Sweep": the laptop's cleaner every five minutes (scripts/workforce/sweep.ts), apart from
#    the runner so a runner that hangs cannot stop it. A task's time limit ends only its hidden launcher, never the pass
#    under it, so passes ran on beside new ones and a studio pass was started every minute (2026-10-27); the sweep ends
#    those with all they started, fails the runs they held and names what waits in the queue.
$sweepAction = New-ScheduledTaskAction -Execute "wscript.exe" `
  -Argument ("`"" + $vbs + "`" `"" + $app + "`" scripts\workforce\sweep.ts sweep")
$sweepTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$sweepSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -Priority 5 `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
Register-ScheduledTask -TaskName "MOP Sweep" -Action $sweepAction -Trigger $sweepTrigger -Settings $sweepSettings `
  -Description "Matter of Place: ends stuck and doubled workforce processes, fails the runs they held, names what waits." -Force | Out-Null
Write-Output "task: MOP Sweep registered (every five minutes, hidden)"

$chrome = @(
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $desktop "Matter of Place Office.lnk"))
if ($chrome) {
  $link.TargetPath = $chrome
  $link.Arguments = "--app=https://matterofplace.com/admin/office"
  $link.IconLocation = $chrome + ",0"
} else {
  $link.TargetPath = "https://matterofplace.com/admin/office"
}
$link.Description = "The Matter of Place office: your AI colleagues, live."
$link.Save()
Write-Output "shortcut: Matter of Place Office on the desktop"
