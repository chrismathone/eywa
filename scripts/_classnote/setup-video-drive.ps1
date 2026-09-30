# 기존 연동 PC에서 Drive 연결. -RestartWorker는 기존 지정 스크립트로 재시작 후 적용을 확인한다.
param(
  [Parameter(Mandatory=$true)][string]$Account,
  [Parameter(Mandatory=$true)][string]$FolderId,
  [switch]$RestartWorker
)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo
if (-not (Test-Path -LiteralPath (Join-Path $repo '.env.local'))) { throw "기존 연동 PC의 저장소 폴더에서 실행하세요." }
if ($RestartWorker) {
  $task = Get-ScheduledTask -TaskName 'eywa-classnote-worker' -ErrorAction SilentlyContinue
  if (-not $task) { throw "기존 클래스노트 워커가 등록된 연동 PC에서만 실행하세요." }
  $taskUser = $task.Principal.UserId
  $taskSid = if ($taskUser -match '^S-1-') { $taskUser } else {
    (New-Object Security.Principal.NTAccount($taskUser)).Translate([Security.Principal.SecurityIdentifier]).Value
  }
  if ($taskSid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) {
    throw "기존 워커를 실행하는 Windows 사용자 계정으로 로그인해서 실행하세요."
  }
}
$gcloudPath = (Get-Command gcloud.ps1 -ErrorAction SilentlyContinue).Source
if (-not $gcloudPath) {
  foreach ($base in @(${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA)) {
    if (-not $base) { continue }
    $candidate = Join-Path $base 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.ps1'
    if (Test-Path -LiteralPath $candidate) { $gcloudPath = $candidate; break }
  }
}
if (-not $gcloudPath) {
  throw "Google Cloud CLI 설치 후 다시 실행하세요: https://cloud.google.com/sdk/docs/install"
}
$env:GOOGLE_DRIVE_GCLOUD_ACCOUNT = $Account
$env:GOOGLE_DRIVE_GCLOUD_PATH = $gcloudPath
$env:CLASSNOTE_VIDEO_DRIVE_FOLDER_ID = $FolderId
# 이미 정상 연결됐으면 다시 동의를 요구하지 않는다. 이 단계에서는 설정 파일을 쓰지 않는다.
& node --env-file=.env.local scripts/_classnote/check-video-drive.mjs
if ($LASTEXITCODE -ne 0) {
  & $gcloudPath auth login $Account --enable-gdrive-access --force --no-activate
  if ($LASTEXITCODE -ne 0) { throw "Google Drive 로그인이 완료되지 않았습니다." }
}
& node --env-file=.env.local scripts/_classnote/video-save-settings.mjs
if ($LASTEXITCODE -ne 0) { throw "폴더 접근 확인 또는 설정 저장에 실패했습니다." }
if ($RestartWorker) {
  $startedAfter = [DateTime]::UtcNow.ToString('o')
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-classnote-pc.ps1')
  if ($LASTEXITCODE -ne 0) { throw "Drive 연결은 저장했지만 워커 재시작에 실패했습니다." }
  & node --env-file=.env.local scripts/_classnote/check-video-worker.mjs --wait "--started-after=$startedAfter"
  if ($LASTEXITCODE -ne 0) { throw "새 워커의 적용을 확인하지 못했습니다. 위의 상태 메시지를 확인하세요." }
  Write-Host "영상 자동 보관 연결 완료. 과거 글·댓글도 이어서 수집합니다."
} else { Write-Host "Drive 연결 완료. 기존 발송PC-지정.bat을 실행해 워커를 재시작하세요." }
