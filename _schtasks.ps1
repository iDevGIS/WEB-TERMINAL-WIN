Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '*Microsoft*' } | ForEach-Object {
  $info = $_ | Get-ScheduledTaskInfo
  $desc = if ($_.Description) { $_.Description -replace '["\u201C\u201D]', "'" } else { $null }
  [PSCustomObject]@{
    Name=$_.TaskName
    Path=$_.TaskPath
    State=$_.State
    Description=$desc
    LastRun=$info.LastRunTime
    NextRun=$info.NextRunTime
    LastResult=$info.LastTaskResult
    Actions=($_.Actions | ForEach-Object { $_.Execute + ' ' + $_.Arguments }) -join '; '
  }
} | ConvertTo-Json -Compress
