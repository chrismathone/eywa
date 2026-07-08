# run-watch-requests.ps1 — 작업 스케줄러용 makeedu 동기화 요청 워처 래퍼 (상시 실행).
#
# 프로덕션 '지금 동기화' 버튼이 makeedu_sync_requests(0069a)에 남긴 요청을 이 PC(신뢰 IP)가 대신 실행한다.
# 등록(1회, 관리자 불필요 — 정식 경로는 setup-sync-pc.ps1. 트리거 = 로그온 + 10분마다 자동 부활):
#   # ⚠️ conhost.exe --headless = 창 없이 실행(Win11 Windows Terminal이 -WindowStyle Hidden 무시 → 창 뜸 → 닫으면 워처 죽음).
#   $action = New-ScheduledTaskAction -Execute "conhost.exe" `
#     -Argument '--headless powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "D:\eywa_refactoring\scripts\_makeedu\run-watch-requests.ps1"'
#   $triggers = @(
#     (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME),
#     (New-ScheduledTaskTrigger -Once -At ([datetime]::Today) -RepetitionInterval (New-TimeSpan -Minutes 10))
#   )  # 10분 반복 = 세션 중 워처가 죽어도(수동 정지·크래시) 자동 재시작. IgnoreNew라 돌면 중복 없음.
#      # RepetitionDuration 생략 = 무기한(MaxValue는 out-of-range 거부, 2026-07-03 실측).
#   $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
#     -MultipleInstances IgnoreNew -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 5)
#   Register-ScheduledTask -TaskName "eywa-makeedu-sync-watcher" -Action $action -Trigger $triggers -Settings $settings
#   Start-ScheduledTask -TaskName "eywa-makeedu-sync-watcher"
#
# 로그는 워처(node)가 직접 <repo>\.makeedu-tmp\watch-requests.log 에 쓴다(장기 실행이라 리다이렉트 캡처 부적합).

$ErrorActionPreference = "Continue"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

& node --env-file=.env.local scripts/_makeedu/watch-sync-requests.cjs
exit $LASTEXITCODE
