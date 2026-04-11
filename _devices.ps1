$video = @()
$audio = @()

# Parse ffmpeg dshow device list
$output = & ffmpeg -list_devices true -f dshow -i dummy 2>&1 | Out-String
foreach ($line in $output.Split("`n")) {
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
