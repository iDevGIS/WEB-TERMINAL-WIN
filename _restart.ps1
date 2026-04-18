# _restart.ps1
# Self-update & restart CYBERFRAME
# รันได้จาก web-terminal โดยไม่ค้าง เพราะ spawn process แยก

# ใช้ path ของ server ที่กำลังรัน ไม่ใช่ path ของ script
$proc = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'server\.js' } | Select-Object -First 1

if ($proc) {
  # ดึง working directory จาก process ที่รันอยู่
  try {
    $handle = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
    $ROOT = Split-Path -Parent $handle.MainModule.FileName
    # MainModule คือ node.exe path ไม่ใช่ working dir — ใช้ script path แทนถ้า server.js อยู่ที่เดียวกัน
  } catch {}
}

# Fallback: ใช้ path ของ script เอง
if (-not $ROOT -or -not (Test-Path (Join-Path $ROOT 'server.js'))) {
  $ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
}

# ถ้ายังหา server.js ไม่เจอ ลองหาจาก Scheduled Task
if (-not (Test-Path (Join-Path $ROOT 'server.js'))) {
  Write-Host "❌ Cannot find server.js in $ROOT" -ForegroundColor Red
  exit 1
}

Write-Host "`n🔄 Pulling latest in $ROOT ..." -ForegroundColor Cyan
Set-Location $ROOT
git pull

# ตรวจ package.json เปลี่ยนหรือไม่
$changed = git diff HEAD~1 --name-only 2>$null | Select-String 'package\.json'
if ($changed) {
  Write-Host "📦 package.json changed — running npm install..." -ForegroundColor Yellow
  npm install --omit=dev 2>$null
}

Write-Host "🚀 Spawning detached restart..." -ForegroundColor Yellow

$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) { $nodePath = 'node' }

$script = @"
Start-Sleep 2
`$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { `$_.CommandLine -match 'server\.js' }
foreach (`$p in `$procs) {
  Stop-Process -Id `$p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep 2
Set-Location '$ROOT'
Start-Process '$nodePath' -ArgumentList 'server.js' -WorkingDirectory '$ROOT' -WindowStyle Hidden
"@

$bytes = [System.Text.Encoding]::Unicode.GetBytes($script)
$encoded = [Convert]::ToBase64String($bytes)
cmd /c start /b powershell -NoProfile -WindowStyle Hidden -EncodedCommand $encoded

Write-Host "✅ CYBERFRAME จะ restart ใน ~4 วินาที ($ROOT)`n" -ForegroundColor Green
