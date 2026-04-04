Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
WshShell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)

' Kill existing CYBERFRAME node process on same port first
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -aon ^| findstr "":3000.*LISTENING""') do taskkill /F /PID %a", 0, True

' Start node hidden
WshShell.Run "node server.js", 0, False
