Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "code.cmd serve-web --host 127.0.0.1 --port 7500 --without-connection-token --accept-server-license-terms", 0, False
