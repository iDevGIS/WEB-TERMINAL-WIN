param([string]$TaskName, [string]$TaskPath)
$t = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath
$info = $t | Get-ScheduledTaskInfo
$triggers = @($t.Triggers | ForEach-Object {
  $type = $_.CimClass.CimClassName -replace 'MSFT_Task','' -replace 'Trigger',''
  [PSCustomObject]@{ Type=$type; Enabled=$_.Enabled; Value=$_.ToString() }
})
$actions = @($t.Actions | ForEach-Object {
  [PSCustomObject]@{ Execute=$_.Execute; Arguments=$_.Arguments; WorkingDirectory=$_.WorkingDirectory }
})
[PSCustomObject]@{
  Name=$t.TaskName
  Path=$t.TaskPath
  State=$t.State
  Description=$t.Description -replace '[\u201C\u201D"]', "'"
  Author=$t.Author
  Date=$t.Date
  URI=$t.URI
  RunAs=$t.Principal.UserId
  RunLevel=$t.Principal.RunLevel.ToString()
  Enabled=$t.Settings.Enabled
  Hidden=$t.Settings.Hidden
  AllowStartIfOnBatteries=$t.Settings.AllowStartIfOnBatteries
  RunOnlyIfNetworkAvailable=$t.Settings.RunOnlyIfNetworkAvailable
  StartWhenAvailable=$t.Settings.StartWhenAvailable
  ExecutionTimeLimit=$t.Settings.ExecutionTimeLimit
  Priority=$t.Settings.Priority
  RestartCount=$t.Settings.RestartCount
  LastRun=$info.LastRunTime
  NextRun=$info.NextRunTime
  LastResult=$info.LastTaskResult
  Triggers=$triggers
  Actions=$actions
} | ConvertTo-Json -Depth 3 -Compress
