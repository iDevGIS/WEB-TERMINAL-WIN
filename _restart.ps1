# _restart.ps1
# Self-update & restart CYBERFRAME
# รันได้จาก web-terminal โดยไม่ค้าง เพราะ spawn process แยก

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "`n🔄 Pulling latest..." -ForegroundColor Cyan
Set-Location $ROOT
git pull

# ตรวจ package.json เปลี่ยนหรือไม่
$changed = git diff HEAD~1 --name-only 2>$null | Select-String 'package\.json'
if ($changed) {
  Write-Host "📦 package.json changed — running npm install..." -ForegroundColor Yellow
  npm install --omit=dev 2>$null
}

Write-Host "🚀 Spawning detached restart..." -ForegroundColor Yellow

$script = @"
Start-Sleep 2
`$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { `$_.CommandLine -match 'server\.js' }
foreach (`$p in `$procs) {
  Stop-Process -Id `$p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep 2
Set-Location '$ROOT'
Start-Process node -ArgumentList 'server.js' -WorkingDirectory '$ROOT' -WindowStyle Hidden
"@

$bytes = [System.Text.Encoding]::Unicode.GetBytes($script)
$encoded = [Convert]::ToBase64String($bytes)
cmd /c start /b powershell -NoProfile -WindowStyle Hidden -EncodedCommand $encoded

Write-Host "✅ CYBERFRAME จะ restart ใน ~4 วินาที`n" -ForegroundColor Green
