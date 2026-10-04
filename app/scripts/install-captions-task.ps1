# B9 step 9, ASSUMED H34 (4): registers the scheduled task "MatterOfPlace Captions", which runs `bun run captions` in the
# app folder every 15 minutes while the operator is signed in (no stored password). The orchestrator runs it at launch
# with the operator's word (L1).
#   powershell -File scripts/install-captions-task.ps1            registers the task, prints "task registered"
#   powershell -File scripts/install-captions-task.ps1 -WhatIf    prints the task it would register, changes nothing
#   powershell -File scripts/install-captions-task.ps1 -Remove    unregisters it, prints "task removed"
param(
  [switch]$Remove,
  [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
$name = "MatterOfPlace Captions"
$app = Split-Path -Parent $PSScriptRoot
$user = "$env:USERDOMAIN\$env:USERNAME"

if ($Remove) {
  if ($WhatIf) {
    Write-Output "would remove task `"$name`""
    exit 0
  }
  Unregister-ScheduledTask -TaskName $name -Confirm:$false
  Write-Output "task removed"
  exit 0
}

$bun = (Get-Command bun).Source
if ($WhatIf) {
  Write-Output "would register task `"$name`": run `"$bun`" run captions in $app every 15 minutes while $user is signed in"
  exit 0
}

$action = New-ScheduledTaskAction -Execute $bun -Argument "run captions" -WorkingDirectory $app
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Write-Output "task registered"
