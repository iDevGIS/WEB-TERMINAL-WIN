# _restart.ps1
# Self-restart script for CYBERFRAME
# รันได้จาก web-terminal โดยไม่ค้าง เพราะใช้ cmd /c start แยก process

$ROOT = "C:\Users\BudToZai\.openclaw\workspace\SCRIPT-TOOLS\WEB-TERMINAL"

Write-Host "🔄 Pulling latest..." -ForegroundColor Cyan
Set-Location $ROOT
git pull

Write-Host "🚀 Spawning detached restart process..." -ForegroundColor Yellow

$script = @"
Start-Sleep 2
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { `$_.CommandLine -match 'server\.js' } | Stop-Process -Force
Start-Sleep 2
Set-Location '$ROOT'
Start-Process node -ArgumentList 'server.js' -WorkingDirectory '$ROOT' -WindowStyle Hidden
"@

# เข้ารหัส script เป็น Base64 เพื่อส่งผ่าน cmd
$bytes = [System.Text.Encoding]::Unicode.GetBytes($script)
$encoded = [Convert]::ToBase64String($bytes)

# สร้าง process แยกจาก parent tree ทั้งหมด
cmd /c start /b powershell -NoProfile -WindowStyle Hidden -EncodedCommand $encoded

Write-Host "✅ Restart scheduled! CYBERFRAME จะ restart ใน ~4 วินาที" -ForegroundColor Green
