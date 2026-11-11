$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Collector.psm1') -Force -DisableNameChecking
Add-Type -AssemblyName System.Windows.Forms
try{
  $dialog=[Windows.Forms.OpenFileDialog]::new();$dialog.Title='에이와 수집 전용 연결 파일 선택';$dialog.Filter='연결 파일 (aywa-collector*.json)|aywa-collector*.json'
  if($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK){exit 0}
  $inputFile=$dialog.FileName;$raw=[IO.File]::ReadAllText($inputFile);$connection=$raw|ConvertFrom-Json;Assert-Connection $connection
  $check=Invoke-CollectorRequest $connection 'GET' $null
  if(-not $check.connected -or $check.tenantId -cne $connection.tenantId -or $check.deviceId -cne $connection.deviceId -or $check.scope -cne $connection.scope){throw 'connection_check_failed'}
  $root=Join-Path $env:LOCALAPPDATA 'AYWA/Collection';$bin=Join-Path $root 'bin'
  [IO.Directory]::CreateDirectory($bin)|Out-Null
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
  foreach($owner in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
  Set-Acl -LiteralPath $root -AclObject $acl
  foreach($name in @('Collector.psm1','Run.ps1')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $bin $name) -Force}
  $secret=ConvertTo-SecureString $raw -AsPlainText -Force;[IO.File]::WriteAllText((Join-Path $root 'connection.dpapi'),($secret|ConvertFrom-SecureString),[Text.UTF8Encoding]::new($false));$raw=$null
  foreach($source in @('makeedu','ecount')){[IO.Directory]::CreateDirectory((Join-Path $root ('inbox/'+$source)))|Out-Null}
  $taskName='AYWA-Collection-'+$connection.tenantId.Substring(0,8)+'-'+$sid.Value.Split('-')[-1]
  $exe=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
  $arguments='-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $bin 'Run.ps1')+'"'
  $prior=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if($prior -and @($prior.Actions|Where-Object {$_.Execute -ne $exe -or $_.Arguments -ne $arguments}).Count){throw 'task_name_conflict'}
  $action=New-ScheduledTaskAction -Execute $exe -Argument $arguments
  $trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
  $principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force|Out-Null
  Write-AtomicJson (Join-Path $root 'installation.json') @{version='1.1.0';taskName=$taskName;tenantId=$connection.tenantId;deviceId=$connection.deviceId;installedAt=[DateTimeOffset]::UtcNow.ToString('o')}
  $answer=[Windows.Forms.MessageBox]::Show('설치 완료. 이 Windows 계정으로 로그인되어 있고 PC가 켜져 있을 때 15분마다 전송합니다. 설치에 사용한 원본 연결 파일을 휴지통으로 옮길까요?','에이와 수집기','YesNo')
  if($answer -eq [Windows.Forms.DialogResult]::Yes){Add-Type -AssemblyName Microsoft.VisualBasic;[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($inputFile,'OnlyErrorDialogs','SendToRecycleBin')}
  Start-Process explorer.exe -ArgumentList ('"'+(Join-Path $root 'inbox')+'"')
}catch{[Windows.Forms.MessageBox]::Show('설치를 완료하지 못했습니다. 기존 에이와 연동 앱은 변경하지 않았습니다. 연결 파일의 만료·해제 상태, 네트워크 및 예약 작업 등록 권한을 확인해 주세요.','에이와 수집기')|Out-Null;exit 1}
