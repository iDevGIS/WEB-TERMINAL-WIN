param(
  [string]$Action,
  [string]$JsonData
)

$ErrorActionPreference = 'Stop'

try {
  $data = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($JsonData)) | ConvertFrom-Json

  function Build-Triggers($triggerList) {
    $triggers = @()
    foreach ($tr in $triggerList) {
      switch ($tr.Type) {
        'Boot'   { $t = New-ScheduledTaskTrigger -AtStartup; if ($tr.Delay) { $t.Delay = $tr.Delay } }
        'Logon'  { $params = @{}; if ($tr.UserId) { $params.User = $tr.UserId }; $t = New-ScheduledTaskTrigger -AtLogOn @params; if ($tr.Delay) { $t.Delay = $tr.Delay } }
        'Daily'  { $t = New-ScheduledTaskTrigger -Daily -At $tr.StartBoundary -DaysInterval ([int]($(if ($tr.DaysInterval) { $tr.DaysInterval } else { 1 }))) }
        'Weekly' {
          $days = @($tr.DaysOfWeek | ForEach-Object { [System.DayOfWeek]$_ })
          $t = New-ScheduledTaskTrigger -Weekly -At $tr.StartBoundary -DaysOfWeek $days -WeeksInterval ([int]($(if ($tr.WeeksInterval) { $tr.WeeksInterval } else { 1 })))
        }
        'Once'   { $t = New-ScheduledTaskTrigger -Once -At $tr.StartBoundary }
        default  { continue }
      }
      if ($null -ne $tr.Enabled) { $t.Enabled = $tr.Enabled }
      $triggers += $t
    }
    return $triggers
  }

  function Build-Actions($actionList) {
    $actions = @()
    foreach ($a in $actionList) {
      if (-not $a.Execute) { continue }
      $params = @{ Execute = $a.Execute }
      if ($a.Arguments) { $params.Argument = $a.Arguments }
      if ($a.WorkingDirectory) { $params.WorkingDirectory = $a.WorkingDirectory }
      $actions += New-ScheduledTaskAction @params
    }
    return $actions
  }

  function Build-Settings($s) {
    $params = @{}
    if ($null -ne $s.Enabled -and -not $s.Enabled) { $params.Disable = $true }
    if ($s.Hidden) { $params.Hidden = $true }
    if ($s.StartWhenAvailable) { $params.StartWhenAvailable = $true }
    if ($s.AllowStartIfOnBatteries) { $params.AllowStartIfOnBatteries = $true }
    if ($s.DontStopIfGoingOnBatteries) { $params.DontStopIfGoingOnBatteries = $true }
    if ($s.RunOnlyIfNetworkAvailable) { $params.RunOnlyIfNetworkAvailable = $true }
    if ($s.ExecutionTimeLimit) { $params.ExecutionTimeLimit = $s.ExecutionTimeLimit }
    if ($null -ne $s.Priority) { $params.Priority = [int]$s.Priority }
    if ($null -ne $s.RestartCount -and $s.RestartCount -gt 0) { $params.RestartCount = [int]$s.RestartCount; $params.RestartInterval = (New-TimeSpan -Minutes 1) }
    return New-ScheduledTaskSettingsSet @params
  }

  switch ($Action) {
    'create' {
      $triggers = Build-Triggers $data.Triggers
      $actions = Build-Actions $data.Actions
      $settings = Build-Settings $data.Settings
      $params = @{
        TaskName = $data.TaskName
        Action = $actions
        Settings = $settings
      }
      if ($data.TaskPath -and $data.TaskPath -ne '\') { $params.TaskPath = $data.TaskPath }
      if ($data.Description) { $params.Description = $data.Description }
      if ($triggers.Count -gt 0) { $params.Trigger = $triggers }
      if ($data.RunLevel -eq 'Highest') {
        $principal = New-ScheduledTaskPrincipal -UserId ($(if ($data.RunAs) { $data.RunAs } else { $env:USERNAME })) -RunLevel Highest -LogonType Interactive
        $params.Principal = $principal
      } elseif ($data.RunAs) {
        $principal = New-ScheduledTaskPrincipal -UserId $data.RunAs -LogonType Interactive
        $params.Principal = $principal
      }
      Register-ScheduledTask @params -Force | Out-Null
      [PSCustomObject]@{ ok=$true; message="Task '$($data.TaskName)' created" } | ConvertTo-Json -Compress
    }
    'update' {
      $task = Get-ScheduledTask -TaskName $data.TaskName -TaskPath $data.TaskPath
      if ($data.Triggers) {
        $triggers = Build-Triggers $data.Triggers
        if ($triggers.Count -gt 0) { $task.Triggers = $triggers }
        else { $task.Triggers = @() }
      }
      if ($data.Actions) {
        $actions = Build-Actions $data.Actions
        if ($actions.Count -gt 0) { $task.Actions = $actions }
      }
      if ($data.Settings) {
        $task.Settings = Build-Settings $data.Settings
      }
      $task | Set-ScheduledTask | Out-Null
      [PSCustomObject]@{ ok=$true; message="Task '$($data.TaskName)' updated" } | ConvertTo-Json -Compress
    }
    'delete' {
      Unregister-ScheduledTask -TaskName $data.TaskName -TaskPath $data.TaskPath -Confirm:$false
      [PSCustomObject]@{ ok=$true; message="Task '$($data.TaskName)' deleted" } | ConvertTo-Json -Compress
    }
    default {
      [PSCustomObject]@{ error="Unknown action: $Action" } | ConvertTo-Json -Compress
    }
  }
} catch {
  [PSCustomObject]@{ error=$_.Exception.Message; detail=$_.ScriptStackTrace } | ConvertTo-Json -Compress
}
