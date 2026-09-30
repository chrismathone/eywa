# 발송 PC에서 Drive OAuth 값 파일(aywa-video-oauth.txt)을 적용한다. 이 PC에는 Google 로그인도 Cloud CLI도 필요 없다.
# 값 파일은 다른 PC에서 `node scripts/_classnote/video-oauth-login.mjs`로 만든다. 적용이 끝나면 값 파일은 지워진다.
# 🔴 값 파일은 **다운로드 폴더**에 둔다 — 저장소·워커 폴더에 두면 다음 워커 zip에 비밀이 실려 나간다(그래서 거기는 찾지 않는다).
param(
  [string]$ValuesFile = "",
  [switch]$AllowFolderChange
)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo
$envFile = Join-Path $repo '.env.local'
if (-not (Test-Path -LiteralPath $envFile)) { throw "기존 연동 PC의 저장소 폴더에서 실행하세요." }
$task = Get-ScheduledTask -TaskName 'eywa-classnote-worker' -ErrorAction SilentlyContinue
if (-not $task) { throw "기존 클래스노트 워커가 등록된 연동 PC에서만 실행하세요." }
$taskUser = $task.Principal.UserId
$taskSid = if ($taskUser -match '^S-1-') { $taskUser } else {
  (New-Object Security.Principal.NTAccount($taskUser)).Translate([Security.Principal.SecurityIdentifier]).Value
}
if ($taskSid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) {
  throw "기존 워커를 실행하는 Windows 사용자 계정으로 로그인해서 실행하세요."
}
# 다운로드 폴더(없으면 바탕화면)에서 가장 최근 값 파일을 고른다 — 다시 받으면 'aywa-video-oauth (1).txt'처럼 이름이 바뀐다.
$found = @()
foreach ($dir in @((Join-Path $env:USERPROFILE 'Downloads'), [Environment]::GetFolderPath('Desktop'))) {
  if ($dir -and (Test-Path -LiteralPath $dir)) {
    $found += @(Get-ChildItem -LiteralPath $dir -Filter 'aywa-video-oauth*.txt' -File -ErrorAction SilentlyContinue)
  }
}
if ($ValuesFile) {
  # 경로를 직접 줬는데 파일이 없으면 멈춘다 — 조용히 '저장된 연결로 재시작'으로 넘어가면 새 값이 적용된 줄 안다.
  if (-not (Test-Path -LiteralPath $ValuesFile)) { throw "지정한 값 파일이 없습니다: $ValuesFile" }
  $ValuesFile = (Resolve-Path -LiteralPath $ValuesFile).Path
} else {
  $newest = $found | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($newest) { $ValuesFile = $newest.FullName }
}
if ($ValuesFile) {
  Write-Host "값 파일: $ValuesFile"
  $saveArgs = @('--env-file=.env.local', 'scripts/_classnote/video-save-oauth-settings.mjs', "--values=$ValuesFile")
  if ($AllowFolderChange) { $saveArgs += '--allow-folder-change' }
  & node @saveArgs
  if ($LASTEXITCODE -ne 0) { throw "값 확인 또는 설정 저장에 실패했습니다. 위 메시지를 확인하세요." }
  # 적용한 것보다 오래된 값 파일은 쓸모없는 비밀이다 — 함께 지운다.
  foreach ($old in $found) {
    if ($old.FullName -ne $ValuesFile -and (Test-Path -LiteralPath $old.FullName)) {
      try { Remove-Item -LiteralPath $old.FullName -Force } catch { Write-Host "옛 값 파일을 지우지 못했습니다 - 직접 지워 주세요: $($old.FullName)" }
    }
  }
} elseif ((Select-String -LiteralPath $envFile -Pattern '^GOOGLE_DRIVE_REFRESH_TOKEN=' -Quiet) -and
    -not (Select-String -LiteralPath $envFile -Pattern '^\s*(export\s+)?GOOGLE_DRIVE_GCLOUD_ACCOUNT\s*=' -Quiet)) {
  # gcloud 계정 줄이 함께 있으면 인증이 그쪽을 먼저 타므로(OAuth가 아니다) 이 길로 오지 않는다 — 값 파일을 다시 요구한다.
  # 저장은 끝났는데 워커 재시작·확인에서 멈췄던 경우 — 값 파일은 이미 지워졌으니 저장된 연결로 나머지만 다시 한다.
  Write-Host "값 파일은 없지만 저장된 Drive 연결이 있습니다. 워커 재시작과 확인만 다시 합니다."
  & node --env-file=.env.local scripts/_classnote/check-video-drive.mjs
  if ($LASTEXITCODE -ne 0) { throw "저장된 Drive 연결로 영상 폴더에 접근하지 못했습니다. 값 파일을 새로 만들어 다운로드 폴더에 넣고 다시 실행하세요." }
} else {
  throw "aywa-video-oauth.txt 파일을 이 PC의 다운로드 폴더에 넣고 다시 실행하세요."
}
$startedAfter = [DateTime]::UtcNow.ToString('o')
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-classnote-pc.ps1')
if ($LASTEXITCODE -ne 0) { throw "Drive 연결은 저장했지만 워커 재시작에 실패했습니다. 이 파일을 다시 실행하면 재시작부터 이어 갑니다." }
& node --env-file=.env.local scripts/_classnote/check-video-worker.mjs --wait "--started-after=$startedAfter"
if ($LASTEXITCODE -ne 0) { throw "새 워커의 적용을 확인하지 못했습니다. 위의 상태 메시지를 확인하고, 이 파일을 다시 실행해 보세요." }
Write-Host "영상 자동 보관 연결 완료(OAuth). 과거 글·댓글도 이어서 수집합니다."
