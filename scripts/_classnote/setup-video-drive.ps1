# 기존 연동 PC에서 1회 실행. 기존 작업 스케줄러/발송 설정은 변경하지 않는다.
param(
  [Parameter(Mandatory=$true)][string]$Account,
  [Parameter(Mandatory=$true)][string]$FolderId
)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo
$gcloud = Get-Command gcloud.ps1 -ErrorAction SilentlyContinue
if (-not $gcloud) {
  throw "Google Cloud CLI 설치 후 다시 실행하세요: https://cloud.google.com/sdk/docs/install"
}
# 공식 사용자 동의 화면. 로그인 완료 전에는 영상 기능을 켜지 않는다.
& $gcloud.Source auth login $Account --enable-gdrive-access --force --no-activate
if ($LASTEXITCODE -ne 0) { throw "Google Drive 로그인이 완료되지 않았습니다." }
$env:GOOGLE_DRIVE_GCLOUD_ACCOUNT = $Account
$env:GOOGLE_DRIVE_GCLOUD_PATH = $gcloud.Source
$env:CLASSNOTE_VIDEO_DRIVE_FOLDER_ID = $FolderId
& node --env-file=.env.local scripts/_classnote/video-save-settings.mjs
if ($LASTEXITCODE -ne 0) { throw "폴더 접근 확인 또는 설정 저장에 실패했습니다." }
Write-Host "Drive 연결 완료. 기존 발송PC-지정.bat을 실행해 워커를 재시작하세요."
