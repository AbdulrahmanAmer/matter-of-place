' W1: run one workforce pass with no visible window (Jay's lesson: powershell -WindowStyle Hidden still flashes).
' wscript.exe has no console; .Run(..., 0, True) hides the window and waits, so the scheduled task stays "running"
' for the whole pass and Windows never starts a second one on top (MultipleInstances IgnoreNew).
' Argument 0: the app folder. The pass's lines go to %USERPROFILE%\.mop-workforce\daemon.log.
Option Explicit
Dim sh, app, logFile
If WScript.Arguments.Count < 1 Then WScript.Quit 1
Set sh = CreateObject("WScript.Shell")
app = WScript.Arguments(0)
logFile = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.mop-workforce\daemon.log"
sh.Run "cmd.exe /c cd /d """ & app & """ && bun scripts\workforce\daemon.ts >> """ & logFile & """ 2>&1", 0, True
