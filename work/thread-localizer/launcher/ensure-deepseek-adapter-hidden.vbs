' Codex Bridge: run the DeepSeek adapter guard without flashing a console window.
' Task Scheduler starts this file with wscript.exe (a GUI host) and it launches
' the interpreter with window style 0 (hidden), so no PowerShell window appears.
' If Codex is not running it quits before spawning any process, and when no
' interpreter can be found it appends the reason to handoff-logs\adapter-guard.log
' so a silent failure cannot happen again.
Option Explicit

Dim shell, fso, wmi, processes, root, guard, interpreter, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)

' Nothing to check while Codex is closed: skip before spawning any process.
On Error Resume Next
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set processes = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='ChatGPT.exe' OR Name='Codex.exe'")
If Err.Number <> 0 Then
  Err.Clear
ElseIf processes.Count = 0 Then
  WScript.Quit 0
End If
On Error GoTo 0

guard = fso.BuildPath(root, "ensure-deepseek-adapter.ps1")
If Not fso.FileExists(guard) Then
  WriteGuardLog "hidden-launcher-missing-guard"
  WScript.Quit 0
End If

interpreter = ResolveInterpreter()
If Len(interpreter) = 0 Then
  WriteGuardLog "hidden-launcher-no-powershell"
  WScript.Quit 0
End If

command = """" & interpreter & """ -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & guard & """"
shell.Run command, 0, False
WScript.Quit 0

' Prefer the interpreter the installer recorded (that also covers the Codex
' runtime copy of PowerShell 7), then the usual install locations, then
' Windows PowerShell as the always-present fallback.
Function ResolveInterpreter()
  Dim candidates, index, candidate, recorded

  recorded = ReadRecordedInterpreter()
  If Len(recorded) > 0 Then
    ResolveInterpreter = recorded
    Exit Function
  End If

  candidates = Array( _
    shell.ExpandEnvironmentStrings("%ProgramFiles%\PowerShell\7\pwsh.exe"), _
    shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\PowerShell\7\pwsh.exe"), _
    shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe"), _
    shell.ExpandEnvironmentStrings("%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe"), _
    shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe") )
  For index = 0 To UBound(candidates)
    candidate = candidates(index)
    If Len(candidate) > 0 Then
      If fso.FileExists(candidate) Then
        ResolveInterpreter = candidate
        Exit Function
      End If
    End If
  Next
  ResolveInterpreter = ""
End Function

Function ReadRecordedInterpreter()
  Dim pathFile, stream, line
  ReadRecordedInterpreter = ""
  pathFile = fso.BuildPath(root, "pwsh-path.txt")
  If Not fso.FileExists(pathFile) Then Exit Function
  On Error Resume Next
  Set stream = fso.OpenTextFile(pathFile, 1)
  If Err.Number = 0 Then
    line = Trim(stream.ReadLine)
    stream.Close
    If Len(line) > 0 Then
      If fso.FileExists(line) Then ReadRecordedInterpreter = line
    End If
  Else
    Err.Clear
  End If
  On Error GoTo 0
End Function

Sub WriteGuardLog(message)
  Dim logDir, logFile, stream
  On Error Resume Next
  logDir = fso.BuildPath(root, "handoff-logs")
  If Not fso.FolderExists(logDir) Then
    fso.CreateFolder logDir
  End If
  logFile = fso.BuildPath(logDir, "adapter-guard.log")
  Set stream = fso.OpenTextFile(logFile, 8, True)
  If Err.Number = 0 Then
    stream.WriteLine Now & " " & message
    stream.Close
  Else
    Err.Clear
  End If
  On Error GoTo 0
End Sub
