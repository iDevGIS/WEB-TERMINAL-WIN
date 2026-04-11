Add-Type -AssemblyName System.Drawing

function Get-ExeIcon($cmd) {
  try {
    if (-not $cmd) { return '' }
    $p = $cmd.Trim()
    # Extract exe path - handle quoted, unquoted with spaces, env vars
    if ($p -match '^"([^"]+)"') { $p = $Matches[1] }
    elseif ($p -match '^(.+?\.exe)') { $p = $Matches[1] }
    else { $p = $p.Split(' ')[0] }
    $p = $p.Trim()
    if ($p -match '%') { $p = [Environment]::ExpandEnvironmentVariables($p) }
    if (-not (Test-Path $p -EA SilentlyContinue)) {
      $f = Get-Command $p -EA SilentlyContinue
      if ($f) { $p = $f.Source }
    }
    if (-not (Test-Path $p -EA SilentlyContinue)) { return '' }
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($p)
    if (-not $icon) { return '' }
    $bmp = $icon.ToBitmap()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $b64 = [Convert]::ToBase64String($ms.ToArray())
    $ms.Dispose(); $bmp.Dispose(); $icon.Dispose()
    return "data:image/png;base64,$b64"
  } catch { return '' }
}

function Get-UwpIcon($pkg) {
  try {
    $appx = Get-AppxPackage -Name ($pkg -replace '_.*','') -EA SilentlyContinue | Select-Object -First 1
    if (-not $appx) { return '' }
    $manifest = Get-AppxPackageManifest -Package $appx.PackageFullName
    $logo = $manifest.Package.Properties.Logo
    $dir = Split-Path (Join-Path $appx.InstallLocation $logo)
    $base = [System.IO.Path]::GetFileNameWithoutExtension($logo)
    $ext = [System.IO.Path]::GetExtension($logo)
    # Find smallest scale variant
    $file = Get-ChildItem $dir -Filter "$base*$ext" -EA SilentlyContinue | Select-Object -First 1
    if (-not $file) { return '' }
    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    return "data:image/png;base64," + [Convert]::ToBase64String($bytes)
  } catch { return '' }
}

$results = @()

# Registry HKCU Run
try {
  $hkcuPath = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
  $hkcu = Get-ItemProperty -Path $hkcuPath -EA SilentlyContinue
  $approved = @{}
  try {
    $ap = Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' -EA Stop
    foreach ($p in $ap.PSObject.Properties) {
      if ($p.Name -notlike 'PS*') {
        $bytes = $p.Value
        if ($bytes -is [byte[]]) { $approved[$p.Name] = ($bytes[0] -eq 2) }
      }
    }
  } catch {}
  if ($hkcu) {
    foreach ($p in $hkcu.PSObject.Properties) {
      if ($p.Name -notlike 'PS*') {
        $enabled = if ($approved.ContainsKey($p.Name)) { $approved[$p.Name] } else { $true }
        $icon = Get-ExeIcon $p.Value
        $results += [PSCustomObject]@{ Name=$p.Name; Command=$p.Value; Source='Registry'; Scope='User'; Enabled=$enabled; Icon=$icon }
      }
    }
  }
} catch {}

# Registry HKLM Run
try {
  $hklmPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
  $hklm = Get-ItemProperty -Path $hklmPath -EA SilentlyContinue
  $approvedLM = @{}
  try {
    $apLM = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' -EA Stop
    foreach ($p in $apLM.PSObject.Properties) {
      if ($p.Name -notlike 'PS*') {
        $bytes = $p.Value
        if ($bytes -is [byte[]]) { $approvedLM[$p.Name] = ($bytes[0] -eq 2) }
      }
    }
  } catch {}
  if ($hklm) {
    foreach ($p in $hklm.PSObject.Properties) {
      if ($p.Name -notlike 'PS*') {
        $enabled = if ($approvedLM.ContainsKey($p.Name)) { $approvedLM[$p.Name] } else { $true }
        $icon = Get-ExeIcon $p.Value
        $results += [PSCustomObject]@{ Name=$p.Name; Command=$p.Value; Source='Registry'; Scope='System'; Enabled=$enabled; Icon=$icon }
      }
    }
  }
} catch {}

# Startup Folder (User)
try {
  $userFolder = [Environment]::GetFolderPath('Startup')
  if (Test-Path $userFolder) {
    Get-ChildItem $userFolder -File | ForEach-Object {
      $target = $_.FullName; $iconTarget = $_.FullName
      if ($_.Extension -eq '.lnk') {
        try { $sh = New-Object -ComObject WScript.Shell; $sc = $sh.CreateShortcut($_.FullName); $target = $sc.TargetPath + ' ' + $sc.Arguments; $iconTarget = $sc.TargetPath } catch {}
      }
      $icon = Get-ExeIcon $iconTarget
      $results += [PSCustomObject]@{ Name=$_.BaseName; Command=$target.Trim(); Source='Folder'; Scope='User'; Enabled=$true; Icon=$icon }
    }
  }
} catch {}

# Startup Folder (All Users)
try {
  $allFolder = [Environment]::GetFolderPath('CommonStartup')
  if (Test-Path $allFolder) {
    Get-ChildItem $allFolder -File | ForEach-Object {
      $target = $_.FullName; $iconTarget = $_.FullName
      if ($_.Extension -eq '.lnk') {
        try { $sh = New-Object -ComObject WScript.Shell; $sc = $sh.CreateShortcut($_.FullName); $target = $sc.TargetPath + ' ' + $sc.Arguments; $iconTarget = $sc.TargetPath } catch {}
      }
      $icon = Get-ExeIcon $iconTarget
      $results += [PSCustomObject]@{ Name=$_.BaseName; Command=$target.Trim(); Source='Folder'; Scope='System'; Enabled=$true; Icon=$icon }
    }
  }
} catch {}

# UWP/Store Apps
try {
  Get-ChildItem 'HKCU:\SOFTWARE\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData' -EA SilentlyContinue | ForEach-Object {
    Get-ChildItem $_.PSPath -EA SilentlyContinue | Where-Object { $_.PSChildName -like '*Startup*' }
  } | ForEach-Object {
    $vals = Get-ItemProperty $_.PSPath -EA SilentlyContinue
    $pkg = $_.PSParentPath.Split('\')[-1]
    $taskName = $_.PSChildName
    $enabled = ($vals.State -eq 2)
    $appx = Get-AppxPackage -Name ($pkg -replace '_.*','') -EA SilentlyContinue | Select-Object -First 1
    $displayName = if ($appx) {
      $n = $appx.Name.Split('.')[-1]
      if ($n -eq $appx.Name) { $pkg.Split('_')[0] } else { $n }
    } else { $pkg.Split('_')[0] }
    $icon = Get-UwpIcon $pkg
    $results += [PSCustomObject]@{ Name=$displayName; Command=$taskName; Source='UWP'; Scope='User'; Enabled=$enabled; Icon=$icon }
  }
} catch {}

$results | ConvertTo-Json -Compress
