# run-watch-requests.ps1 — 작업 스케줄러용 makeedu 동기화 요청 워처 래퍼 (상시 실행).
#
# 프로덕션 '지금 동기화' 버튼이 makeedu_sync_requests(0069a)에 남긴 요청을 이 PC(신뢰 IP)가 대신 실행한다.
# 등록(1회, 관리자 불필요 — 로그온 시 자동 시작 + 즉시 시작):
#   $action = New-ScheduledTaskAction -Execute "powershell.exe" `
#     -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "D:\eywa_refactoring\scripts\_makeedu\run-watch-requests.ps1"'
#   $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
#   $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
#     -MultipleInstances IgnoreNew -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 5)
#   Register-ScheduledTask -TaskName "eywa-makeedu-sync-watcher" -Action $action -Trigger $trigger -Settings $settings
#   Start-ScheduledTask -TaskName "eywa-makeedu-sync-watcher"
#
# 로그는 워처(node)가 직접 D:\tmp\makeedu\watch-requests.log 에 쓴다(장기 실행이라 리다이렉트 캡처 부적합).

$ErrorActionPreference = "Continue"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

& node --env-file=.env.local scripts/_makeedu/watch-sync-requests.cjs
exit $LASTEXITCODE
