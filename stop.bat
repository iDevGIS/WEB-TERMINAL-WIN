@echo off
echo Stopping CYBERFRAME...
taskkill /F /FI "WINDOWTITLE eq CYBERFRAME*" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
echo CYBERFRAME stopped.
