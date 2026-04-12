$video = @()
$audio = @()

# Run ffmpeg and capture stderr (where device list goes)
$pinfo = New-Object System.Diagnostics.ProcessStartInfo
$pinfo.FileName = "ffmpeg"
$pinfo.Arguments = "-list_devices true -f dshow -i dummy"
$pinfo.RedirectStandardError = $true
$pinfo.RedirectStandardOutput = $true
$pinfo.UseShellExecute = $false
$pinfo.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($pinfo)
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit(8000) | Out-Null

foreach ($line in $stderr.Split("`n")) {
  if ($line -match '\[dshow.*\]\s+"(.+?)"\s+\((video|audio|none)\)') {
    $name = $Matches[1]
    $type = $Matches[2]
    if ($type -eq 'video' -or $type -eq 'none') { $video += $name }
    if ($type -eq 'audio') { $audio += $name }
  }
}

[PSCustomObject]@{
  video = $video
  audio = $audio
} | ConvertTo-Json -Compress
