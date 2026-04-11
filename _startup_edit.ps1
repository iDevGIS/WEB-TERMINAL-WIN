param(
  [string]$Action,
  [string]$JsonData
)
$ErrorActionPreference = 'Stop'
try {
  $data = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($JsonData)) | ConvertFrom-Json

  switch ($Action) {
    'enable' {
      if ($data.Source -eq 'UWP') {
        # UWP startup task - Command contains the task ID
        $basePath = 'HKCU:\SOFTWARE\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData'
        Get-ChildItem $basePath -EA SilentlyContinue | ForEach-Object {
          $taskPath = Join-Path $_.PSPath $data.Command
          if (Test-Path $taskPath) { Set-ItemProperty -Path $taskPath -Name 'State' -Value 2 }
        }
      } else {
        $regPath = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
        if ($data.Scope -eq 'System') { $regPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' }
        $bytes = (Get-ItemProperty -Path $regPath -Name $data.Name -ErrorAction Stop).$($data.Name)
        $bytes[0] = 2
        Set-ItemProperty -Path $regPath -Name $data.Name -Value $bytes
      }
      [PSCustomObject]@{ ok=$true; message="Enabled '$($data.Name)'" } | ConvertTo-Json -Compress
    }
    'disable' {
      if ($data.Source -eq 'UWP') {
        $basePath = 'HKCU:\SOFTWARE\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData'
        Get-ChildItem $basePath -EA SilentlyContinue | ForEach-Object {
          $taskPath = Join-Path $_.PSPath $data.Command
          if (Test-Path $taskPath) { Set-ItemProperty -Path $taskPath -Name 'State' -Value 1 }
        }
      } else {
        $regPath = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
        if ($data.Scope -eq 'System') { $regPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' }
        $bytes = $null
        try { $bytes = (Get-ItemProperty -Path $regPath -Name $data.Name -ErrorAction Stop).$($data.Name) } catch {}
        if (-not $bytes) { $bytes = [byte[]](2,0,0,0,0,0,0,0,0,0,0,0) }
        $bytes[0] = 3
        Set-ItemProperty -Path $regPath -Name $data.Name -Value $bytes
      }
      [PSCustomObject]@{ ok=$true; message="Disabled '$($data.Name)'" } | ConvertTo-Json -Compress
    }
    'delete' {
      if ($data.Source -eq 'Registry') {
        $regPath = if ($data.Scope -eq 'System') { 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' } else { 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' }
        Remove-ItemProperty -Path $regPath -Name $data.Name -ErrorAction SilentlyContinue
        $approvedPath = if ($data.Scope -eq 'System') { 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' } else { 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' }
        Remove-ItemProperty -Path $approvedPath -Name $data.Name -ErrorAction SilentlyContinue
      } elseif ($data.Source -eq 'Folder') {
        $folder = if ($data.Scope -eq 'System') { [Environment]::GetFolderPath('CommonStartup') } else { [Environment]::GetFolderPath('Startup') }
        $files = Get-ChildItem $folder -File | Where-Object { $_.BaseName -eq $data.Name }
        foreach ($f in $files) { Remove-Item $f.FullName -Force }
      }
      [PSCustomObject]@{ ok=$true; message="Deleted '$($data.Name)'" } | ConvertTo-Json -Compress
    }
    'add' {
      if ($data.Source -eq 'Folder') {
        $folder = if ($data.Scope -eq 'System') { [Environment]::GetFolderPath('CommonStartup') } else { [Environment]::GetFolderPath('Startup') }
        $sh = New-Object -ComObject WScript.Shell
        $sc = $sh.CreateShortcut("$folder\$($data.Name).lnk")
        $sc.TargetPath = $data.Command
        if ($data.Arguments) { $sc.Arguments = $data.Arguments }
        if ($data.WorkingDirectory) { $sc.WorkingDirectory = $data.WorkingDirectory }
        $sc.Save()
      } else {
        $regPath = if ($data.Scope -eq 'System') { 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' } else { 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' }
        Set-ItemProperty -Path $regPath -Name $data.Name -Value $data.Command
      }
      [PSCustomObject]@{ ok=$true; message="Added '$($data.Name)'" } | ConvertTo-Json -Compress
    }
    default {
      [PSCustomObject]@{ error="Unknown action: $Action" } | ConvertTo-Json -Compress
    }
  }
} catch {
  [PSCustomObject]@{ error=$_.Exception.Message } | ConvertTo-Json -Compress
}
