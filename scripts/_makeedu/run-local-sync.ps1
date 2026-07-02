# run-local-sync.ps1 — Windows 작업 스케줄러용 makeedu→eywa 로컬 동기화 래퍼.
#
# 왜 로컬인가: makeedu가 세션/로그인을 "신뢰 IP(집)"에 묶어 GitHub 데이터센터 IP를 거부한다.
# 집 IP에선 헤드리스 새 로그인이 CAPTCHA 없이 통과하므로(검증됨), 세션 캡처 없이 매 실행 새로 로그인한다.
#
# 전제: .env.local 에 MAKEEDU_ID / MAKEEDU_PW / DATABASE_URL (형님이 관리, 스크립트만 읽음). node 가 PATH 에.
# 등록(1회, 아래 Register-ScheduledTask) 후 PC 가 켜져 있으면 하루 2회(06/18시) 자동 실행.
# 로그: D:\tmp\makeedu\sync-local.log (실패해도 다음 실행이 additive·멱등으로 따라잡음 = 데이터 손실 0).

$ErrorActionPreference = "Continue"
# 이 스크립트 위치(scripts/_makeedu) 기준으로 repo 루트 도출 → 경로 하드코딩 없이 이동 가능.
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo

# ⚠️ 로그 인코딩: node 는 UTF-8 로 출력하는데 Windows PowerShell 5.1 은 기본 OEM 코드페이지로 읽고
#    `*>>` 리다이렉트는 UTF-16 으로 써서 로그 한글이 깨진다. → 콘솔 출력 인코딩을 UTF-8 로 맞추고,
#    node 출력을 문자열로 캡처해 Add-Content -Encoding UTF8 로 일관 기록(읽을 땐 Get-Content -Encoding UTF8).
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$logDir = "D:\tmp\makeedu"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
$log = Join-Path $logDir "sync-local.log"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Add-Content -Path $log -Encoding UTF8 -Value "`n===== $stamp  동기화 시작 (repo: $repo) ====="
# node 실행(stdout+stderr) → 문자열 캡처 → UTF-8 로 append. --env-file 로 .env.local 로드(비밀은 node 가 읽음).
$env:MAKEEDU_TRIGGER = "scheduled"  # 실행 로그(0070a makeedu_sync_runs) 트리거 라벨
$out = & node --env-file=.env.local scripts/_makeedu/sync-all.cjs --apply 2>&1 | Out-String
$code = $LASTEXITCODE
Add-Content -Path $log -Encoding UTF8 -Value $out
Add-Content -Path $log -Encoding UTF8 -Value "===== $stamp  종료 (exit $code) ====="
exit $code
