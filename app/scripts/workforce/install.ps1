# W1: installs the workforce on this laptop (PowerShell 5.1: no ternary, no ??).
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\workforce\install.ps1
# 1. The scheduled task "MOP Workforce": one hidden pass every minute, never two at once.
# 2. The desktop shortcut "Matter of Place Office": the office as its own window (Chrome app mode).
# Remove both with: Unregister-ScheduledTask -TaskName "MOP Workforce" -Confirm:$false; and delete the shortcut.
$ErrorActionPreference = "Stop"
$app = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$home2 = Join-Path $env:USERPROFILE ".mop-workforce"
New-Item -ItemType Directory -Force -Path $home2 | Out-Null

$vbs = Join-Path $PSScriptRoot "hidden-run.vbs"
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument ("`"" + $vbs + "`" `"" + $app + "`"")
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 50)
Register-ScheduledTask -TaskName "MOP Workforce" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Matter of Place AI colleagues: one pass a minute (scripts/workforce/daemon.ts)." -Force | Out-Null
Write-Output "task: MOP Workforce registered (every minute, hidden)"

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
