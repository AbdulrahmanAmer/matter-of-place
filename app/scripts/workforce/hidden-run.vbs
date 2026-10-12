' W1: run one workforce pass with no visible window (Jay's lesson: powershell -WindowStyle Hidden still flashes).
' wscript.exe has no console; .Run(..., 0, True) hides the window and waits, so the scheduled task stays "running"
' for the whole pass and Windows never starts a second one on top (MultipleInstances IgnoreNew).
' Argument 0: the app folder. Argument 1 (optional): the script to run, default the workforce pass. Argument 2
' (optional): the log's name, default daemon. Lines go to %USERPROFILE%\.mop-workforce\<name>.log.
Option Explicit
Dim sh, app, script, logName, logFile
If WScript.Arguments.Count < 1 Then WScript.Quit 1
Set sh = CreateObject("WScript.Shell")
app = WScript.Arguments(0)
script = "scripts\workforce\daemon.ts"
If WScript.Arguments.Count > 1 Then script = WScript.Arguments(1)
logName = "daemon"
If WScript.Arguments.Count > 2 Then logName = WScript.Arguments(2)
logFile = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.mop-workforce\" & logName & ".log"
sh.Run "cmd.exe /c cd /d """ & app & """ && bun " & script & " >> """ & logFile & """ 2>&1", 0, True
